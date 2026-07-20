/**
 * Directory Session 3a — Google Places match (Phoenix metro).
 *
 * For each Phoenix-metro facility_listings row, finds it on Google Places (New) searchText,
 * validates the top result by distance (≤500m), and stores ONLY the place_id (per brief §6 —
 * no other Places data is persisted; ratings/hours/phone are refresh-on-render later). Also
 * stamps metro_area='Phoenix' on the set so 3b/3c can scope cleanly.
 *
 * Usage (needs GOOGLE_MAPS_API_KEY + Supabase service role in .env.local; the key must have
 * "Places API (New)" enabled in Google Cloud Console):
 *   node scripts/match-places.mjs --dry-run   # search + report matches/misses, NO writes
 *   node scripts/match-places.mjs             # live: writes google_place_id + metro_area
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const KEY = env.GOOGLE_MAPS_API_KEY
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
if (!KEY || !env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing GOOGLE_MAPS_API_KEY / Supabase env in .env.local'); process.exit(1) }

const DRY_RUN = process.argv.includes('--dry-run')
// Phoenix metro bounding box (Phoenix/Scottsdale/Tempe/Mesa/Chandler/Gilbert/Glendale/Peoria/…).
const PHX = { state: 'AZ', latMin: 33.0, latMax: 34.0, lngMin: -112.8, lngMax: -111.4 }
const MATCH_RADIUS_M = 500

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function distM(aLat, aLng, bLat, bLng) {
  const R = 6371000, dLat = ((bLat - aLat) * Math.PI) / 180, dLng = ((bLng - aLng) * Math.PI) / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(x))
}

let anyOk = false // once one call succeeds, a later 403 is propagation lag, not a disabled API
async function searchText(name, city, lat, lng, attempt = 1) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'places.id,places.displayName,places.location' },
    body: JSON.stringify({
      textQuery: `${name} pickleball ${city || ''}`.trim(),
      locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 2000 } },
      maxResultCount: 3,
    }),
  })
  if (res.ok) { anyOk = true; return res.json() }
  const body = await res.text()
  // 403 before ANY success = API genuinely not enabled → fast fail with guidance.
  if (res.status === 403 && !anyOk) {
    console.error(`\n✋ Places API (New) is not enabled on GOOGLE_MAPS_API_KEY. Enable it in Cloud Console, then re-run.\n   ${body.slice(0, 220)}`)
    process.exit(1)
  }
  // Transient (propagation 403 after a success, 429, 5xx) → retry with backoff.
  if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt < 5) {
    await sleep(3000 * attempt)
    return searchText(name, city, lat, lng, attempt + 1)
  }
  const err = new Error(`HTTP ${res.status}: ${body.slice(0, 180)}`); err.status = res.status; throw err
}

// ---- main ------------------------------------------------------------------
const { data: rows, error } = await db.from('facility_listings')
  .select('id, name, city, lat, lng, google_place_id')
  .eq('state', PHX.state)
  .gte('lat', PHX.latMin).lte('lat', PHX.latMax).gte('lng', PHX.lngMin).lte('lng', PHX.lngMax)
  .is('google_place_id', null)
  .order('name')
if (error) { console.error('select failed:', error.message); process.exit(1) }

console.log(`Places match — ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'} — ${rows.length} unmatched Phoenix facility(ies)\n`)

if (!DRY_RUN && rows.length) {
  // Stamp metro_area='Phoenix' on the whole bbox set (decision d) — scopes 3b/3c later.
  const { error: mErr } = await db.from('facility_listings').update({ metro_area: 'Phoenix' })
    .eq('state', PHX.state).gte('lat', PHX.latMin).lte('lat', PHX.latMax).gte('lng', PHX.lngMin).lte('lng', PHX.lngMax).is('metro_area', null)
  if (mErr) console.warn('  metro_area stamp warning:', mErr.message)
}

let matched = 0, missed = 0
for (const r of rows) {
  let json
  try { json = await searchText(r.name, r.city, r.lat, r.lng) }
  catch (e) { console.warn(`  ${r.name}: error ${e.message} — skipping`); missed++; await sleep(300); continue }
  const top = (json.places || [])[0]
  const d = top?.location ? distM(r.lat, r.lng, top.location.latitude, top.location.longitude) : null
  if (top && d != null && d <= MATCH_RADIUS_M) {
    matched++
    console.log(`  ✓ ${r.name}  →  ${top.displayName?.text} (${Math.round(d)}m)  ${top.id}`)
    if (!DRY_RUN) {
      const { error: uErr } = await db.from('facility_listings').update({ google_place_id: top.id }).eq('id', r.id)
      if (uErr) console.warn(`    write failed: ${uErr.message}`)
    }
  } else {
    missed++
    console.log(`  ·  ${r.name}  →  ${top ? `too far (${Math.round(d)}m): ${top.displayName?.text}` : 'no result'}`)
  }
  await sleep(300) // polite
}

console.log(`\n${DRY_RUN ? 'DRY RUN' : 'DONE'} — matched ${matched}, missed ${missed}, of ${rows.length}`)
