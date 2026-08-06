import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { clip, coerceVenueDetail } from '@/lib/locations/submissionFields'
import { createFacilityListing } from '@/lib/locations/createFacilityListing'

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Best-effort forward geocode so a new venue gets map coordinates. Never throws.
async function geocode(parts: (string | null)[]): Promise<{ lat: number; lng: number } | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  const query = parts.filter(Boolean).join(', ')
  if (!key || !query) return null
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${key}`)
    const json = await res.json()
    const loc = json?.results?.[0]?.geometry?.location
    if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') return { lat: loc.lat, lng: loc.lng }
  } catch {
    /* venue still saves without coordinates */
  }
  return null
}

// The metro this row is filed under. locations.metro_area is NOT NULL and, since
// 20260724000001 dropped its 'Las Vegas' default, has no default either — so an
// insert that omits it fails with 23502 and the submission 500s. That is exactly
// what happened between 2026-07-24 and this fix: zero venues reached the pending
// queue in that window.
//
// The literal rather than the submitted city, for two reasons:
//   1. we have not derived an MSA. ADR-19 scopes the directory to a defined list of
//      111 metros, and turning "Henderson" into a metro name is inference — the
//      class of guess that produces confident wrong facts.
//   2. scripts/gen-vegas-parity.mjs selects locations with `.eq('metro_area',
//      'Las Vegas')` to generate parity facility_listings rows. A user submission
//      that happened to name a covered city would be swept into a curated parity
//      run it was never reviewed for. 'Unknown' cannot match any metro-scoped filter.
// No app code reads locations.metro_area (verified across **/*.{ts,tsx} and
// scripts/**/*.mjs, 2026-08-06); every metro read in the directory is
// facility_listings.metro_area. So this value is a constraint satisfier, not a label
// anyone renders.
const UNRESOLVED_METRO = 'Unknown'

// POST /api/locations — add a venue that isn't in the directory yet.
// Any authenticated user creating a league / tournament / play session may add
// one; it becomes a normal active location (crowd-sourced). court_count, is_active
// and sort_order use table defaults; metro_area and access_type are server-set
// because neither has a usable default. locations has no client INSERT policy, so
// this service-role route is the write path (and the auth boundary).
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const raw = clip(body.name, 200)
  if (!raw) return NextResponse.json({ error: 'Location name is required' }, { status: 400 })
  const name = raw.replace(/\s+/g, ' ') // collapse internal whitespace

  const db = admin()
  const cols = 'id, name, court_count, access_type, subarea, address, city, state, zip_code, country, lat, lng'

  // Dedup: reuse an existing venue with the same name (case-insensitive) rather
  // than creating a twin. Escape LIKE metacharacters so ilike is an exact match.
  const escaped = name.replace(/[\\%_]/g, (c) => `\\${c}`)
  const { data: existing } = await db.from('locations').select(cols).ilike('name', escaped).limit(1)
  if (existing && existing.length > 0) {
    return NextResponse.json({ location: existing[0], reused: true }, { status: 200 })
  }

  const address = clip(body.address, 300)
  const city = clip(body.city, 120)
  const state = clip(body.state, 60)
  const zip_code = clip(body.zip_code, 20)
  const country = clip(body.country, 60) ?? 'US'

  // Optional venue detail. Errors only ever come from the numeric fields — an unrecognized enum is
  // dropped rather than failing the submission. See lib/locations/submissionFields.ts.
  const { detail, errors } = coerceVenueDetail(body)
  if (errors.length > 0) return NextResponse.json({ error: errors[0], errors }, { status: 400 })

  // Geocode the address the user confirmed, so the venue shows up on the map picker.
  //
  // DELIBERATELY NOT THE PLACES COORDINATE, even when the address came from Places autocomplete
  // (owner decision, 2026-08-06). Persisting a Places `location` is the same ToS class as
  // persisting its `formatted_address`, which ADR-12 bars. Geocoding the confirmed address keeps
  // the coordinate's provenance identical to what this route has always done, and it is still far
  // more accurate than before because the address itself is now validated.
  const coords = await geocode([name, address, city, state, zip_code])

  const place_id = clip(body.google_place_id, 300)

  // The canonical venue record (ADR-13). Created BEFORE the operational row so the bridge can be
  // set in a single insert — a listing with no location is an orphan nobody sees, whereas a
  // location with a dangling facility_listing_id would be a broken reference.
  let listing: { id: string; slug: string } | null = null
  try {
    listing = await createFacilityListing(
      db,
      {
        name,
        address,
        city,
        state,
        zip_code,
        country,
        google_place_id: place_id,
        coordinateSource: coords ? 'google_geocoding' : null,
        ...(coords ?? {}),
      },
      detail,
      user.id
    )
  } catch (e) {
    // The operational row is what the user is actually waiting on — it is what makes their venue
    // selectable in the form they are filling in. A directory-side failure must not cost them
    // that, so the submission proceeds with a NULL bridge and the detail is lost rather than the
    // venue. The admin queue shows an unbridged row, which is the visible signal to look.
    console.error('facility listing creation failed; saving location without the bridge', e)
  }

  const row = {
    name,
    address,
    city,
    state,
    zip_code,
    country,
    metro_area: UNRESOLVED_METRO, // NOT NULL, no default — see above
    access_type: 'public', // constrained enum; user venues default to public
    created_by: user.id,
    status: 'pending', // hidden from other users' pickers until approved
    facility_listing_id: listing?.id ?? null, // ADR-13 bridge
    ...(coords ?? {}),
  }

  const { data, error } = await db.from('locations').insert(row).select(cols).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ location: data }, { status: 201 })
}
