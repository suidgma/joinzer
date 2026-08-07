/**
 * NAIP aerial geocode QA — render a contact sheet of published venue coordinates for human review.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------------------------
 * Four coordinate errors reached `status='published'` in one week, and every automated guard we have
 * passed all four:
 *
 *   Sedgefield Country Club  right club, WRONG CAMPUS. High precision, right city, right zip, inside
 *                            the metro envelope, correct organization. No guard fired.
 *   a Jackson MS venue       a `low` street anchor sitting 1,099 m from the actual courts.
 *   Middleton ID             pinned to a "Middleton Street" in WEST VIRGINIA.
 *   a Toledo university      anchored on a Subway sandwich shop at the campus street number.
 *
 * Each is instantly obvious in an aerial crop and structurally invisible to a rule that only sees
 * fields. That is the whole justification for the tool, and it is also why 0.6 m resolution is
 * sufficient HERE despite being far too coarse to tell a pickleball court from a tennis court:
 * GROSS location errors survive coarse imagery fine.
 *
 * ---------------------------------------------------------------------------------------------
 * SCOPE — READ-ONLY, AND STAYS THAT WAY
 * ---------------------------------------------------------------------------------------------
 * This script SELECTs from facility_listings and writes nothing back. No migration, no storage
 * bucket, no pipeline stage, no og:image, no column. If a future change here starts wanting a column
 * to store a verdict in, that is a different slice with its own gate — the value of this instrument
 * is that it can be run, read and thrown away without touching the system of record.
 *
 * ---------------------------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------------------------
 *   node scripts/naip-geocode-qa.mjs --metro=Syracuse
 *   node scripts/naip-geocode-qa.mjs --metro=Syracuse --dry-run       # zero requests, just the plan
 *   node scripts/naip-geocode-qa.mjs --all                            # every published metro
 *
 *   --metro=<name>       metro_area exactly as stored (e.g. "Las Vegas", "Greensboro-High Point")
 *   --all                every metro with published rows, one sheet each
 *   --out=<dir>          default metro-research/naip-qa
 *   --ground-meters=<n>  crop width on the ground, default 400
 *   --size=<px>          crop pixels per side, default 640 (~0.62 m/px, near NAIP native)
 *   --format=jpg|png     default jpg — ~1/8 the bytes of png at this scale, and a contact sheet is
 *                        read at a glance rather than pixel-peeped
 *   --delay-ms=<n>       courtesy spacing between live requests, default 300
 *   --limit=<n>          first N venues only, for a quick look
 *   --refetch            ignore cached crops/metadata and re-request. NOT needed after a coordinate
 *                        repair — a moved pin invalidates its own crop automatically (see cropStamp)
 *   --dry-run            print what would be fetched and exit without a single request
 *
 * Output per metro, under `--out`:
 *   <metro-key>/index.html          the contact sheet
 *   <metro-key>/crops/<slug>.jpg    the aerial crops   — these files ARE the cache
 *   <metro-key>/identify/<slug>.json the raw identify responses
 *   <metro-key>/stamps/<slug>.json   what each crop is a crop OF (coordinate + geometry), so a
 *                                    repaired pin re-fetches instead of serving the old image
 *
 * The default output directory is inside `metro-research/`, which is a junction to a repo outside
 * every working tree — the same reasoning as the geocode cache. A worktree teardown removes the
 * link, not the artifacts, so a sheet survives the session that produced it.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  identifyPoint, exportCrop, chooseSize, setSpacingMs, liveRequestCount, NOMINAL_GSD_M,
  cropStamp, stampMatches,
} from './lib/naip-imagery.mjs'
import {
  openingHintFromProvenance, stalenessVerdict, streetBandVerdict, uninformativeReasons, renderContactSheet,
} from './lib/naip-contact-sheet.mjs'

// ---------------------------------------------------------------------------------------------
// Args + env
// ---------------------------------------------------------------------------------------------
const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name, fallback = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const METRO = opt('metro')
const ALL = flag('all')
const DRY_RUN = flag('dry-run')
const REFETCH = flag('refetch')
const OUT_DIR = opt('out', 'metro-research/naip-qa')
const GROUND_M = Number(opt('ground-meters', '400'))
const FORMAT = opt('format', 'jpg')
const LIMIT = opt('limit') ? Number(opt('limit')) : null
const SIZE = opt('size') ? Number(opt('size')) : chooseSize({ groundMeters: GROUND_M, targetGsd: NOMINAL_GSD_M })

if (!METRO && !ALL) {
  console.error('Pass --metro=<name> or --all.  See the header of this file for the full option list.')
  process.exit(1)
}
if (!Number.isFinite(GROUND_M) || GROUND_M <= 0) {
  console.error(`--ground-meters must be a positive number (got ${JSON.stringify(opt('ground-meters'))})`)
  process.exit(1)
}
if (!['jpg', 'png'].includes(FORMAT)) {
  console.error(`--format must be jpg or png (got ${JSON.stringify(FORMAT)})`)
  process.exit(1)
}

setSpacingMs(Number(opt('delay-ms', '300')))

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

/**
 * Curated opening dates, slug -> { opened: "YYYY" | "YYYY-MM", source: "<url or note>" }.
 *
 * Optional and usually near-empty: the automatic provenance scan already covers the venues whose
 * research recorded an opening in prose. This file is where a human PINS one the scan cannot see, or
 * corrects one it read wrong. Absent file = no curated entries, which is a normal state.
 */
const KNOWN_OPENINGS_PATH = 'scripts/naip-qa-known-openings.json'
let knownOpenings = {}
if (existsSync(KNOWN_OPENINGS_PATH)) {
  try {
    knownOpenings = JSON.parse(readFileSync(KNOWN_OPENINGS_PATH, 'utf8'))
  } catch (err) {
    console.warn(`  ${KNOWN_OPENINGS_PATH} will not parse (${err.message}) — continuing with provenance hints only`)
  }
}

/** A filesystem-safe directory name for a metro. `metro_area` carries spaces, periods and hyphens
 *  ("Tampa-St. Petersburg-Clearwater"), none of which belong in a path. */
const metroKey = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// ---------------------------------------------------------------------------------------------
// One metro
// ---------------------------------------------------------------------------------------------
async function runMetro(metro) {
  const { data: rows, error } = await db.from('facility_listings')
    .select('name, slug, lat, lng, indoor, location_precision, provenance')
    .eq('status', 'published').eq('metro_area', metro)
    .not('lat', 'is', null).not('lng', 'is', null)
    .order('name')
  if (error) throw new Error(`select failed for ${metro}: ${error.message}`)

  const venues = LIMIT ? rows.slice(0, LIMIT) : rows
  const dir = join(OUT_DIR, metroKey(metro))
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

  console.log(`\n${metro} — ${venues.length} published venue(s) with coordinates`)
  console.log(`  crop     : ${GROUND_M} m across at ${SIZE} px (${(GROUND_M / SIZE).toFixed(2)} m/px requested)`)
  console.log(`  output   : ${dir}`)
  if (DRY_RUN) {
    // A crop whose stamp does not match today's coordinate/geometry is NOT cached — counting it as
    // cached would under-report the live requests a real run is about to issue, which is the one
    // number this stage exists to state.
    const cached = venues.filter((v) => {
      if (!existsSync(join(dir, 'crops', `${v.slug}.${FORMAT}`))) return false
      if (!existsSync(join(dir, 'identify', `${v.slug}.json`))) return false
      const p = join(dir, 'stamps', `${v.slug}.json`)
      if (!existsSync(p)) return false
      try {
        return stampMatches(JSON.parse(readFileSync(p, 'utf8')), cropStamp({ lat: v.lat, lng: v.lng, groundMeters: GROUND_M, size: SIZE, format: FORMAT }))
      } catch { return false }
    }).length
    console.log(`  DRY RUN  — would issue ~${(venues.length - (REFETCH ? 0 : cached)) * 2} live request(s); ${cached} venue(s) already cached`)
    return null
  }

  const rendered = []
  for (const [i, v] of venues.entries()) {
    const cropFile = join('crops', `${v.slug}.${FORMAT}`)
    const cropPath = join(dir, cropFile)
    const idPath = join(dir, 'identify', `${v.slug}.json`)
    const stampPath = join(dir, 'stamps', `${v.slug}.json`)

    // A slug outlives a coordinate repair, so a slug-keyed cache will happily serve the OLD crop
    // beside the NEW coordinate. The stamp is what makes a moved pin invalidate its own cache
    // without anyone remembering to pass --refetch. See cropStamp for the full argument.
    const stamp = cropStamp({ lat: v.lat, lng: v.lng, groundMeters: GROUND_M, size: SIZE, format: FORMAT })
    let previousStamp = null
    if (existsSync(stampPath)) {
      try { previousStamp = JSON.parse(readFileSync(stampPath, 'utf8')) } catch { /* treat as unstamped */ }
    }
    const staleCache = existsSync(cropPath) && !stampMatches(previousStamp, stamp)
    if (staleCache) {
      console.log(`  moved [${String(i + 1).padStart(3)}/${venues.length}] ${v.name} — cached crop was fetched for ${previousStamp ? `${previousStamp.lat},${previousStamp.lng} at ${previousStamp.groundMeters} m/${previousStamp.size} px` : 'unrecorded inputs'}; re-fetching`)
    }
    const refetchThis = REFETCH || staleCache

    let summary = { date: null, dates: [], gsd: null, gsdUnits: null }
    let cropError = null
    let cachedBoth = true
    try {
      const id = await identifyPoint({ lat: v.lat, lng: v.lng, cachePath: idPath, refetch: refetchThis })
      summary = id.summary
      cachedBoth = cachedBoth && id.cached
    } catch (err) {
      console.warn(`  !  ${v.name}: identify failed — ${err.message}`)
    }
    try {
      const crop = await exportCrop({
        lat: v.lat, lng: v.lng, groundMeters: GROUND_M, size: SIZE, format: FORMAT,
        cachePath: cropPath, refetch: refetchThis,
      })
      cachedBoth = cachedBoth && crop.cached
      // Written only after the crop is on disk, so a failed fetch never leaves a stamp claiming a
      // crop that does not exist — and the next run retries rather than trusting it.
      mkdirSync(join(dir, 'stamps'), { recursive: true })
      writeFileSync(stampPath, JSON.stringify(stamp))
    } catch (err) {
      cropError = err.message
      console.warn(`  !  ${v.name}: crop failed — ${err.message}`)
    }

    // Curated first, provenance prose second. Both are labelled in the sheet so a reviewer can tell
    // a checked date from a machine-read one.
    const curated = knownOpenings[v.slug]
    const hint = curated ? null : openingHintFromProvenance(v.provenance)
    const opened = curated?.opened ?? hint?.opened ?? null
    const openedSource = curated ? 'curated' : hint ? 'provenance' : null

    const stale = stalenessVerdict({ imageryDate: summary.date, opened, openedSource })
    // Read off the row, not off the imagery — and therefore true whether or not a crop came back.
    const band = streetBandVerdict({ precision: v.location_precision, provenance: v.provenance })
    rendered.push({
      name: v.name,
      slug: v.slug,
      lat: v.lat,
      lng: v.lng,
      precision: v.location_precision,
      cropFile: cropError ? null : cropFile.replace(/\\/g, '/'),
      cropError,
      imageryDate: summary.date,
      imageryDates: summary.dates,
      gsd: summary.gsd,
      gsdUnits: summary.gsdUnits,
      stale: stale.stale ? stale : null,
      streetBand: band.streetBand ? band : null,
      uninformative: uninformativeReasons({
        imageryDate: summary.date, indoor: v.indoor, stale: stale.stale, streetBand: band.streetBand,
      }),
    })

    const mark = band.streetBand ? 'BAND ' : stale.stale ? 'STALE' : cropError ? 'ERR  ' : cachedBoth ? 'cache' : '  ·  '
    console.log(`  ${mark} [${String(i + 1).padStart(3)}/${venues.length}] ${v.name} — ${summary.date || 'no imagery'}`)
  }

  mkdirSync(dir, { recursive: true })
  const html = renderContactSheet({
    metro,
    venues: rendered,
    generatedAt,
    params: { groundMeters: GROUND_M, size: SIZE },
  })
  const indexPath = join(dir, 'index.html')
  writeFileSync(indexPath, html)

  const staleCount = rendered.filter((v) => v.stale).length
  const bandCount = rendered.filter((v) => v.streetBand).length
  const dimCount = rendered.filter((v) => v.uninformative.length).length
  const dates = [...new Set(rendered.map((v) => v.imageryDate).filter(Boolean))].sort()
  console.log(`\n  ${metro}: ${rendered.length} cell(s) — ${staleCount} stale, ${bandCount} street-band anchor, ${dimCount} likely-uninformative, ${rendered.length - dimCount} worth a look`)
  console.log(`  acquisition dates: ${dates.join(', ') || 'none'}`)
  console.log(`  sheet: ${indexPath}`)
  return { metro, indexPath, count: rendered.length, staleCount, bandCount, dimCount, dates }
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------
let metros = [METRO]
if (ALL) {
  // PAGED DELIBERATELY. supabase-js caps a .select() at 1000 rows and returns the truncated set with
  // no error and no flag — so the obvious one-shot version of this query silently drops every metro
  // whose rows sort past row 1000. There are ~1,700 published rows, so it would have lost real metros
  // and the run would have looked complete. Page until a short page proves the end.
  const PAGE = 1000
  const seen = new Set()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('facility_listings')
      .select('metro_area').eq('status', 'published').not('metro_area', 'is', null)
      .order('metro_area').range(from, from + PAGE - 1)
    if (error) { console.error('metro list failed:', error.message); process.exit(1) }
    for (const r of data) seen.add(r.metro_area)
    if (data.length < PAGE) break
  }
  metros = [...seen].sort()
  console.log(`--all: ${metros.length} metro(s) with published rows`)
}

const results = []
for (const m of metros) results.push(await runMetro(m))

console.log(`\nDone — ${liveRequestCount()} live request(s) to imagery.nationalmap.gov`)
for (const r of results.filter(Boolean)) console.log(`  ${r.metro}: ${r.indexPath}`)
