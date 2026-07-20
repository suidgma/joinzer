/**
 * Directory Session 2 — OSM pickleball-court bulk ingest (nationwide).
 *
 * Queries Overpass per US state for anything tagged sport~pickleball, normalizes OSM
 * tags → facility_listings columns, and idempotently upserts on osm_id. Re-runnable at
 * any time. Local script only (not a cron / edge function), per the directory brief §5.
 *
 * Idempotency: upsert keyed on osm_id. Only OSM-sourced columns are (re)written; a
 * re-run NEVER clobbers downstream work — existing rows keep their slug (URL stability),
 * status, location_id, google_place_id, enrichment*, metro_area. New rows land as 'draft'.
 *
 * Usage (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local):
 *   node scripts/ingest-osm-courts.mjs --dry-run --state=AZ   # validate one state, no writes
 *   node scripts/ingest-osm-courts.mjs --dry-run              # nationwide count, no writes
 *   node scripts/ingest-osm-courts.mjs                        # live nationwide upsert
 *   node scripts/ingest-osm-courts.mjs --resume               # skip states already in the progress log
 * Optional: OVERPASS_URL env override (default overpass-api.de).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ---- env (manual .env.local parse — no dotenv) -----------------------------
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const OVERPASS_URL = process.env.OVERPASS_URL || env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter'
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env in .env.local'); process.exit(1) }
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// ---- args ------------------------------------------------------------------
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const RESUME = args.includes('--resume')
const ONE_STATE = (args.find((a) => a.startsWith('--state=')) || '').split('=')[1]?.toUpperCase() || null
const PROGRESS_FILE = 'scripts/.osm-ingest-progress.json'
const UA = 'JoinzerDirectoryBot/1.0 (+https://www.joinzer.com; marty@joinzer.com)'

// 50 states + DC (ISO 3166-2 second part). Territories excluded (US only per brief).
const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']

// ---- helpers ---------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function kebab(s) {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}
function baseSlug(name, city, state) {
  return [name, city, state].map(kebab).filter(Boolean).join('-') || 'court'
}
// Deterministic, stable collision suffix from the osm_id so a facility keeps its slug across runs.
function uniqueSlug(base, osmId, slugSet) {
  if (!slugSet.has(base)) { slugSet.add(base); return base }
  const suf = kebab(osmId.replace('/', '-'))
  let s = `${base}-${suf}`, i = 2
  while (slugSet.has(s)) s = `${base}-${suf}-${i++}`
  slugSet.add(s); return s
}
function mapAccess(a) {
  if (!a) return 'unknown'
  a = a.toLowerCase()
  if (['yes', 'public', 'permissive', 'designated'].includes(a)) return 'public'
  if (['private', 'no'].includes(a)) return 'private'
  if (['customers', 'permit', 'members', 'membership'].includes(a)) return 'membership'
  return 'unknown'
}
function boolTag(v) {
  if (v == null) return null
  v = String(v).toLowerCase()
  if (['yes', 'true', '1'].includes(v)) return true
  if (['no', 'false', '0'].includes(v)) return false
  return null
}

// Overpass POST with polite retry/backoff on 429/5xx/timeout.
async function overpass(query, attempt = 1) {
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: 'data=' + encodeURIComponent(query),
    })
    if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status)
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()).slice(0, 160))
    return await res.json()
  } catch (e) {
    if (attempt >= 4) throw e
    const wait = 5000 * Math.pow(3, attempt - 1) // 5s, 15s, 45s
    console.warn(`    retry ${attempt} (${e.message}) — waiting ${wait / 1000}s`)
    await sleep(wait)
    return overpass(query, attempt + 1)
  }
}

function queryFor(state) {
  return `[out:json][timeout:180];area["ISO3166-2"="US-${state}"]["admin_level"="4"]->.a;nwr["sport"~"pickleball"](area.a);out center;`
}

// OSM element → facility_listings row (OSM-sourced columns only; slug assigned by caller).
function normalize(el, state) {
  const t = el.tags || {}
  // Named-only ingest (Option A): unnamed OSM pitch polygons are ~98% of matches and are noise for an
  // SEO directory (redundant per-court objects, no rankable name). Clustering them into facilities is a
  // separate future step. Keep only features with a real name.
  const name = t.name || t.official_name || t['name:en'] || t.alt_name || null
  if (!name) return null
  const lat = el.lat ?? el.center?.lat ?? null
  const lng = el.lon ?? el.center?.lon ?? null
  if (lat == null || lng == null) return null // no coords → unusable for the directory
  let indoor = boolTag(t.indoor)
  if (indoor === null && boolTag(t.covered) === true) indoor = true
  const address = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null
  return {
    osm_id: `${el.type}/${el.id}`,
    source: 'osm',
    name,
    lat, lng,
    address,
    city: t['addr:city'] || null,
    state,                         // always known from the queried chunk (decision b)
    zip: t['addr:postcode'] || null,
    country: 'US',
    court_count: /^\d+$/.test(t.courts || '') ? parseInt(t.courts, 10) : null, // 'courts' only; capacity ambiguous (c)
    access_type: mapAccess(t.access),
    indoor,
    lighting: boolTag(t.lit),
    surface: t.surface || null,
    last_synced_at: new Date().toISOString(),
    _base: baseSlug(name, t['addr:city'], state),
  }
}

// ---- main ------------------------------------------------------------------
const progress = RESUME && existsSync(PROGRESS_FILE) ? JSON.parse(readFileSync(PROGRESS_FILE, 'utf8')) : {}
const states = ONE_STATE ? [ONE_STATE] : STATES

console.log(`OSM pickleball ingest — ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'} — ${states.length} state(s) via ${OVERPASS_URL}\n`)

// Preload existing osm_id→slug + all slugs (URL stability + collision avoidance).
const { data: existingRows, error: preErr } = await db.from('facility_listings').select('osm_id, slug')
if (preErr) { console.error('preload failed:', preErr.message); process.exit(1) }
const osmToSlug = new Map((existingRows ?? []).map((r) => [r.osm_id, r.slug]))
const slugSet = new Set((existingRows ?? []).map((r) => r.slug))
console.log(`preloaded ${osmToSlug.size} existing listing(s)\n`)

let totFetched = 0, totNew = 0, totExisting = 0, totSkipped = 0
const diag = { samples: [], acc: {}, withAddr: 0, withCourt: 0, withSurface: 0, withIndoor: 0, fallbackName: 0 } // dry-run only

for (const state of states) {
  // On --resume, skip only states that SUCCEEDED; error entries are retried (e.g. Overpass throttling).
  if (RESUME && progress[state] && !progress[state].error) { console.log(`${state}: skip (done)`); continue }
  process.stdout.write(`${state}: querying… `)
  let json
  try { json = await overpass(queryFor(state)) }
  catch (e) { console.log(`FAILED (${e.message})`); progress[state] = { error: e.message, at: new Date().toISOString() }; continue }

  const els = json.elements || []
  const rows = []
  let skipped = 0
  for (const el of els) {
    const r = normalize(el, state)
    if (!r) { skipped++; continue }
    const base = r._base; delete r._base
    r.slug = osmToSlug.has(r.osm_id) ? osmToSlug.get(r.osm_id) : uniqueSlug(base, r.osm_id, slugSet)
    rows.push(r)
    if (DRY_RUN) {
      diag.acc[r.access_type] = (diag.acc[r.access_type] || 0) + 1
      if (r.address) diag.withAddr++
      if (r.court_count != null) diag.withCourt++
      if (r.surface) diag.withSurface++
      if (r.indoor != null) diag.withIndoor++
      if (r.name === 'Pickleball Courts') diag.fallbackName++
      if (diag.samples.length < 6) diag.samples.push(`${r.osm_id}  "${r.name}"  ${r.city || '(no city)'},${r.state}  access=${r.access_type}  slug=${r.slug}`)
    }
  }
  const newCount = rows.filter((r) => !osmToSlug.has(r.osm_id)).length
  const existCount = rows.length - newCount

  if (!DRY_RUN && rows.length) {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500)
      const { error } = await db.from('facility_listings').upsert(chunk, { onConflict: 'osm_id' })
      if (error) { console.log(`\n  UPSERT ERROR: ${error.message}`); process.exit(1) }
    }
    // Reflect newly-inserted osm_ids/slugs so later states in the same run see them as existing.
    for (const r of rows) osmToSlug.set(r.osm_id, r.slug)
  }

  totFetched += els.length; totNew += newCount; totExisting += existCount; totSkipped += skipped
  progress[state] = { fetched: els.length, new: newCount, existing: existCount, skipped, at: new Date().toISOString() }
  if (!DRY_RUN) writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2))
  console.log(`${els.length} found → ${newCount} new, ${existCount} existing, ${skipped} skipped(unnamed/no-coords)`)
  await sleep(2000) // polite gap between Overpass calls
}

console.log(`\n${DRY_RUN ? 'DRY RUN' : 'DONE'} — fetched ${totFetched}, new ${totNew}, existing ${totExisting}, skipped ${totSkipped}`)

if (DRY_RUN) {
  const n = totNew + totExisting
  console.log(`\ncoverage (of ${n} usable rows):`)
  console.log(`  address: ${diag.withAddr} (${((diag.withAddr / n) * 100).toFixed(0)}%) · court_count: ${diag.withCourt} (${((diag.withCourt / n) * 100).toFixed(0)}%) · surface: ${diag.withSurface} · indoor known: ${diag.withIndoor} · fallback-name: ${diag.fallbackName}`)
  console.log(`  access_type:`, diag.acc)
  console.log(`\nsample rows:`)
  for (const s of diag.samples) console.log('  ' + s)
}
