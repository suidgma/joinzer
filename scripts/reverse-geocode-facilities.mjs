/**
 * Directory Session 3d-0 — reverse-geocode coord-only facility_listings to fill `city`.
 *
 * OSM ingest left some rows with lat/lng but no city, which fails the (new) publish gate. This
 * fills city (+ state/zip when null) from the venue's coordinates via Google Geocoding (reverse).
 * Metro-scoped, idempotent (only touches rows where city IS NULL), dry-run first.
 *
 *   node scripts/reverse-geocode-facilities.mjs --metro=Phoenix --dry-run
 *   node scripts/reverse-geocode-facilities.mjs --metro=Phoenix
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)
const KEY = env.GOOGLE_MAPS_API_KEY
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
if (!KEY || !env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing GOOGLE_MAPS_API_KEY / Supabase env'); process.exit(1) }

const DRY_RUN = process.argv.includes('--dry-run')
const METRO = (process.argv.find((a) => a.startsWith('--metro=')) || '').split('=')[1]
if (!METRO) { console.error('Pass --metro=<name>'); process.exit(1) }

const comp = (components, type, key = 'long_name') => components.find((c) => c.types.includes(type))?.[key] || null
async function reverse(lat, lng, attempt = 1) {
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${KEY}`)
  const json = await res.json()
  if (json.status === 'OK' && json.results?.length) {
    // prefer the most specific result that carries a locality
    for (const r of json.results) {
      const city = comp(r.address_components, 'locality') || comp(r.address_components, 'postal_town') || comp(r.address_components, 'sublocality') || comp(r.address_components, 'administrative_area_level_3')
      if (city) return { city, state: comp(r.address_components, 'administrative_area_level_1', 'short_name'), zip: comp(r.address_components, 'postal_code') }
    }
    return { city: null, state: null, zip: null }
  }
  if ((json.status === 'OVER_QUERY_LIMIT' || json.status === 'UNKNOWN_ERROR') && attempt < 4) { await new Promise((r) => setTimeout(r, 2000 * attempt)); return reverse(lat, lng, attempt + 1) }
  return { city: null, state: null, zip: null, err: json.status + (json.error_message ? ` — ${json.error_message}` : '') }
}

const { data: rows, error } = await db.from('facility_listings')
  .select('id, name, lat, lng, city, state, zip')
  .eq('metro_area', METRO).not('lat', 'is', null).not('lng', 'is', null).is('city', null).order('name')
if (error) { console.error('select failed:', error.message); process.exit(1) }

console.log(`Reverse-geocode — ${DRY_RUN ? 'DRY RUN' : 'LIVE'} — metro=${METRO} — ${rows.length} coord-only row(s)\n`)
let filled = 0, missed = 0
for (const r of rows) {
  const g = await reverse(r.lat, r.lng)
  if (!g.city) { console.log(`  ·  ${r.name}  →  no city (${g.err || 'no locality'})`); missed++; await new Promise((s) => setTimeout(s, 120)); continue }
  const patch = { city: g.city }
  if (!r.state && g.state) patch.state = g.state
  if (!r.zip && g.zip) patch.zip = g.zip
  console.log(`  ✓  ${r.name}  →  ${g.city}${g.state ? ', ' + g.state : ''}${g.zip ? ' ' + g.zip : ''}`)
  filled++
  if (!DRY_RUN) { const { error: uErr } = await db.from('facility_listings').update(patch).eq('id', r.id); if (uErr) console.warn(`     write failed: ${uErr.message}`) }
  await new Promise((s) => setTimeout(s, 120))
}
console.log(`\n${DRY_RUN ? 'DRY RUN' : 'DONE'} — filled ${filled}, no-city ${missed}, of ${rows.length}`)
