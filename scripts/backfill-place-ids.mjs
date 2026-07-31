/**
 * Backfill facility_listings.google_place_id via Google Places (New) searchText.
 *
 * WHY: lib/directory/mapsUrl.ts links to a venue's Google Maps card via place_id. Without one the
 * link degrades to a name+address text query, or — for a row with no address — to a bare
 * coordinate, which Maps renders as an anonymous dropped pin. As of 2026-07-30, 53 of 236
 * published rows had no place_id, including 100% of the Daytona and Greensboro batches.
 *
 * ADR-12: place_id is the ONLY Places datum we may persist. Nothing else from the response is
 * written — displayName and location are used in-memory to validate the match, then discarded.
 * ADR-14: per-record lookups only, never a bulk scrape. Requests are sequential and rate-limited.
 *
 * Two phases, deliberately split so the paid calls happen exactly once and the write applies
 * exactly what a human reviewed:
 *
 *   node scripts/backfill-place-ids.mjs --metro=Phoenix,Reno-Sparks --dry-run
 *       → one Places call per row, validates each hit by distance, writes proposals to
 *         place-id-backfill/<stamp>.json. NO database writes.
 *
 *   node scripts/backfill-place-ids.mjs --apply=place-id-backfill/<stamp>.json
 *       → ZERO Places calls. Re-checks each row is still published and still null, then writes.
 *
 * Omitting --metro scopes to every published row with no place_id. Rows are never overwritten:
 * both the select and the update are guarded on google_place_id IS NULL.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const KEY = env.GOOGLE_MAPS_API_KEY
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing Supabase env in .env.local'); process.exit(1) }

const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=')
const DRY_RUN = process.argv.includes('--dry-run')
const APPLY_FILE = arg('apply')
const METROS = arg('metro') ? arg('metro').split(',').map((s) => s.trim()).filter(Boolean) : null
// Re-run just specific rows — e.g. retrying a row that missed under the default query.
const SLUGS = arg('slugs') ? arg('slugs').split(',').map((s) => s.trim()).filter(Boolean) : null

if (!DRY_RUN && !APPLY_FILE) {
  console.error('Pass --dry-run (search + propose) or --apply=<file> (write reviewed proposals).')
  process.exit(1)
}
if (DRY_RUN && APPLY_FILE) { console.error('--dry-run and --apply are mutually exclusive.'); process.exit(1) }

// A hit further than this from the stored coordinate is not the same venue. 500 m is the radius
// scripts/match-places.mjs used for the Phoenix pass; keep them the same so results are comparable.
const MATCH_RADIUS_M = 500

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function distM(aLat, aLng, bLat, bLng) {
  const R = 6371000, dLat = ((bLat - aLat) * Math.PI) / 180, dLng = ((bLng - aLng) * Math.PI) / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(x))
}

/**
 * Rows barred from backfill regardless of scope, because a Places match against their stored data
 * would write a confidently WRONG place_id. Both are draft today, so the status filter below already
 * excludes them — this list is the belt-and-braces guard for the day someone adds a --include-drafts
 * flag. Remove an entry only once the underlying defect is fixed.
 */
/**
 * Per-slug replacements for the default "<name> pickleball <city> <state>" query.
 *
 * Two failure shapes justify one: a venue whose courts sit inside a much larger park, where the
 * park name outranks the facility ("Bur-Mil Park" returns the park, not the tennis/pickleball
 * center inside it); and a venue whose operator styles the name in a form Places indexed but our
 * display name does not use ("The Center @ Bishop Park"). Both were predicted by the name audit
 * before the run, and the park-vs-facility one was observed firing on Bishop Park.
 *
 * An override changes only the SEARCH STRING. The ≤500 m distance check against the stored
 * coordinate still decides whether the hit is accepted, so a bad override cannot smuggle a wrong
 * place_id past the guard — it just misses.
 */
const QUERY_OVERRIDES = {
  'bur-mil-park-greensboro-nc': 'The Family Tennis and Pickleball Center Bur-Mil Park Greensboro NC',
  'the-center-at-bishop-park-bryant-ar': 'The Center @ Bishop Park Bryant AR',
  // Inverse of the usual problem: the corrected official dedication name finds nothing within 5 km,
  // because Places indexes this venue under the colloquial name the city actually uses.
  'jessie-stevenson-kovalenko-memorial-gymnasium-new-smyrna-beach-fl': 'City Gym pickleball New Smyrna Beach FL',
}

const NEVER_BACKFILL = {
  'pickleball-kingdom-little-rock-ar':
    'Stored address (11210 Bass Pro Pkwy) and coordinate (34.6621223,-92.4105104) are both wrong — the real venue is ~7.6 km away near 2616 S Shackleford Rd. A match on that coordinate would pin a different business.',
  'tyndall-park-benton-ar':
    "The row's own controlling-entity source lists 4 tennis + 2 basketball courts and no pickleball; the pickleball claim is aggregator-only, which ADR-14 makes insufficient on its own.",
}

/** Published rows in scope that still have no place_id. */
async function loadTargets() {
  let q = db.from('facility_listings')
    .select('id, name, slug, address, city, state, zip, lat, lng, metro_area')
    .eq('status', 'published').is('google_place_id', null)
    .not('lat', 'is', null).not('lng', 'is', null)
  if (METROS) q = q.in('metro_area', METROS)
  if (SLUGS) q = q.in('slug', SLUGS)
  const { data, error } = await q.order('metro_area').order('name')
  if (error) { console.error('select failed:', error.message); process.exit(1) }

  const barred = data.filter((r) => NEVER_BACKFILL[r.slug])
  for (const r of barred) console.log(`  ⛔ EXCLUDED ${r.slug} — ${NEVER_BACKFILL[r.slug]}`)
  return data.filter((r) => !NEVER_BACKFILL[r.slug])
}

// ---- dry run: search + propose -----------------------------------------------------------------

let anyOk = false // once one call succeeds, a later 403 is propagation lag, not a disabled API
async function searchText(row, attempt = 1) {
  // Bias to a 2 km circle around the stored coordinate so a same-named venue in another metro
  // cannot outrank the real one. The distance check below is the actual guard; this just helps.
  const textQuery = QUERY_OVERRIDES[row.slug] || [row.name, 'pickleball', row.city, row.state].filter(Boolean).join(' ')
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'places.id,places.displayName,places.location' },
    body: JSON.stringify({
      textQuery,
      locationBias: { circle: { center: { latitude: row.lat, longitude: row.lng }, radius: 2000 } },
      maxResultCount: 3,
    }),
  })
  if (res.ok) { anyOk = true; return { json: await res.json(), textQuery } }
  const body = await res.text()
  if (res.status === 403 && !anyOk) {
    console.error(`\n✋ Places API (New) is not enabled on GOOGLE_MAPS_API_KEY. Enable it, then re-run.\n   ${body.slice(0, 220)}`)
    process.exit(1)
  }
  if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt < 5) {
    await sleep(3000 * attempt)
    return searchText(row, attempt + 1)
  }
  const err = new Error(`HTTP ${res.status}: ${body.slice(0, 180)}`); err.status = res.status; throw err
}

async function dryRun() {
  if (!KEY) { console.error('Missing GOOGLE_MAPS_API_KEY in .env.local'); process.exit(1) }
  const rows = await loadTargets()
  console.log(`Place-ID backfill — DRY RUN (no DB writes) — metro=${METROS ? METROS.join(', ') : 'ALL'}`)
  console.log(`${rows.length} published row(s) with no place_id → ${rows.length} Places call(s)\n`)

  const proposals = []
  // Misses are recorded with their full candidate list, not just logged. Places does NOT always rank
  // the right venue first: hayes-taylor-memorial-ymca matched 'Simkins Indoor Sports Pavilion' at
  // 414 m while the exact-name 'Hayes-Taylor Memorial YMCA' sat 3 m away as runner-up 2. If only the
  // top hit is kept, a rescuable row looks like a hard miss and the evidence to rescue it is gone.
  const misses = []
  let matched = 0, missed = 0
  for (const r of rows) {
    let out
    try { out = await searchText(r) }
    catch (e) { console.warn(`  ✗ ${r.name} — error ${e.message}`); missed++; await sleep(300); continue }
    const candidates = (out.json.places || []).map((p) => ({
      place_id: p.id,
      display_name: p.displayName?.text ?? null,
      dist_m: p.location ? Math.round(distM(r.lat, r.lng, p.location.latitude, p.location.longitude)) : null,
    }))
    const top = candidates[0]
    const ok = top && top.dist_m != null && top.dist_m <= MATCH_RADIUS_M

    if (ok) {
      matched++
      console.log(`  ✓ ${r.name} (${r.city}, ${r.state})`)
      console.log(`      → ${top.display_name}  ${top.dist_m}m  ${top.place_id}`)
      proposals.push({
        id: r.id, slug: r.slug, listing_name: r.name, city: r.city, state: r.state,
        metro_area: r.metro_area, address: r.address,
        query: out.textQuery, place_id: top.place_id, matched_name: top.display_name,
        dist_m: top.dist_m, runners_up: candidates.slice(1),
      })
    } else {
      missed++
      console.log(`  ·  ${r.name} (${r.city}, ${r.state})`)
      console.log(`      → ${top ? `REJECTED too far (${top.dist_m}m): ${top.display_name}` : 'no result'}`)
      // Surface any candidate that IS inside the radius, so review can rescue a mis-ranked row.
      const rescuable = candidates.filter((c) => c.dist_m != null && c.dist_m <= MATCH_RADIUS_M)
      for (const c of rescuable) console.log(`      ⚑ but candidate in range: ${c.display_name}  ${c.dist_m}m  ${c.place_id}`)
      misses.push({
        id: r.id, slug: r.slug, listing_name: r.name, city: r.city, state: r.state,
        metro_area: r.metro_area, address: r.address, query: out.textQuery,
        candidates, rescuable_candidates: rescuable,
      })
    }
    await sleep(300)
  }

  // Guard: a place_id must not already belong to another listing, and must be unique in this batch.
  const ids = proposals.map((p) => p.place_id)
  const dupeInBatch = ids.filter((id, i) => ids.indexOf(id) !== i)
  const { data: live } = await db.from('facility_listings').select('slug, google_place_id').in('google_place_id', ids.length ? ids : ['__none__'])
  const collisions = (live || []).filter((l) => l.google_place_id)

  mkdirSync('place-id-backfill', { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = `place-id-backfill/${stamp}.json`
  writeFileSync(file, JSON.stringify({
    _meta: {
      generated: new Date().toISOString(), metros: METROS, match_radius_m: MATCH_RADIUS_M,
      rows_in_scope: rows.length, matched, missed,
      dupe_place_ids_in_batch: dupeInBatch, collisions_with_live_rows: collisions,
      note: 'Hand-review every entry, delete any you reject, then --apply this file. Applying makes zero Places calls.',
      review_checklist: [
        'Compare each proposal against its runners_up — the top hit is NOT always the right venue (see hayes-taylor).',
        'Closer is not automatically better: a generic "Pickleball Courts" POI or an informal duplicate can outrank the correctly-named venue.',
        'Check misses[].rescuable_candidates — a row can miss on its top hit while holding a valid in-range candidate.',
      ],
    },
    proposals,
    misses,
  }, null, 2))

  console.log(`\nDRY RUN — matched ${matched}, missed ${missed}, of ${rows.length}`)
  if (dupeInBatch.length) console.log(`⚠ duplicate place_id within batch: ${dupeInBatch.join(', ')}`)
  if (collisions.length) console.log(`⚠ place_id already on a live row: ${collisions.map((c) => `${c.google_place_id} (${c.slug})`).join(', ')}`)
  console.log(`Proposals written to ${file} — review, then: node scripts/backfill-place-ids.mjs --apply=${file}`)
}

// ---- apply: write reviewed proposals, zero API calls --------------------------------------------

async function apply() {
  const doc = JSON.parse(readFileSync(APPLY_FILE, 'utf8'))
  const proposals = doc.proposals || []
  console.log(`Place-ID backfill — APPLY from ${APPLY_FILE}`)
  console.log(`${proposals.length} reviewed proposal(s). No Places calls will be made.\n`)

  if (doc._meta?.dupe_place_ids_in_batch?.length || doc._meta?.collisions_with_live_rows?.length) {
    console.error('✋ This file recorded a place_id collision. Resolve it before applying.')
    process.exit(1)
  }

  let written = 0, skipped = 0
  for (const p of proposals) {
    // Re-check state at write time: still published, still null. Guards against the row having
    // been changed between the dry run and the apply.
    const { data, error } = await db.from('facility_listings')
      .update({ google_place_id: p.place_id })
      .eq('id', p.id).eq('status', 'published').is('google_place_id', null)
      .select('id, name, google_place_id')
    if (error) { console.error(`  ✗ ${p.listing_name}: ${error.message}`); continue }
    if (!data || data.length === 0) { console.log(`  · ${p.listing_name} — skipped (no longer published/null)`); skipped++; continue }
    console.log(`  ✓ ${data[0].name} → ${data[0].google_place_id}`)
    written++
  }
  console.log(`\nDONE — wrote ${written}, skipped ${skipped}, of ${proposals.length}`)
}

await (DRY_RUN ? dryRun() : apply())
