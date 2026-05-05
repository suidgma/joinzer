/**
 * One-time script: geocode all locations and write lat/lng back to Supabase.
 * Run: node scripts/geocode-locations.mjs
 * Requires GOOGLE_MAPS_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

// Parse .env.local manually (no dotenv dependency needed)
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=')
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()]
    })
)

const MAPS_KEY = env['GOOGLE_MAPS_API_KEY']
const SUPABASE_URL = env['NEXT_PUBLIC_SUPABASE_URL']
const SERVICE_KEY = env['SUPABASE_SERVICE_ROLE_KEY']

if (!MAPS_KEY || !SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing required env vars. Check .env.local.')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_KEY)

async function geocode(name, address, city) {
  const query = address ? `${address}, ${city}, NV` : `${name}, ${city}, NV`
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${MAPS_KEY}`
  const res = await fetch(url)
  const json = await res.json()
  if (json.status !== 'OK' || !json.results[0]) {
    return null
  }
  const { lat, lng } = json.results[0].geometry.location
  return { lat, lng }
}

const { data: locations, error } = await db
  .from('locations')
  .select('id, name, address, city')
  .order('name')

if (error) {
  console.error('Failed to fetch locations:', error.message)
  process.exit(1)
}

console.log(`Geocoding ${locations.length} locations…\n`)

let succeeded = 0
let failed = 0

for (const loc of locations) {
  const coords = await geocode(loc.name, loc.address, loc.city)
  if (!coords) {
    console.warn(`  MISS  ${loc.name}`)
    failed++
    continue
  }

  const { error: updateError } = await db
    .from('locations')
    .update({ lat: coords.lat, lng: coords.lng })
    .eq('id', loc.id)

  if (updateError) {
    console.warn(`  ERR   ${loc.name}: ${updateError.message}`)
    failed++
  } else {
    console.log(`  OK    ${loc.name}  (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`)
    succeeded++
  }

  // Stay well within Google's rate limit
  await new Promise((r) => setTimeout(r, 100))
}

console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`)
