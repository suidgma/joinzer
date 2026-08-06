/**
 * Creates the canonical `facility_listings` record for a user-submitted venue (ADR-13).
 *
 * ADR-13 makes `facility_listings` the canonical venue record and `locations` operational; the
 * deprecated `locations.notes/phone/source_url/category` columns are marked "stop writing". Phase
 * 3B (the write-path cutover) is still pending overall — this pulls it forward for the
 * user-submission flow only, which is why nothing else in the app changes.
 *
 * THREE INVARIANTS. Each is load-bearing and none is obvious from the row shape alone.
 *
 * 1. `verified_by` IS NEVER SET. It is the release fence. scripts/publish-facilities.mjs is a
 *    RECONCILING gate — it publishes eligible drafts on its own, and `passesReleaseFence(row)` in
 *    scripts/lib/publish-gate.mjs is literally `row.verified_by != null`. A user-submitted row
 *    with a name, a coordinate, a city and a slug otherwise passes the ADR-17 gate, so the NULL
 *    here is the only thing standing between a crowd-sourced row and /courts. Do not stamp it,
 *    and do not "helpfully" set it on approval without a separate decision.
 *
 * 2. `metro_area` IS NULL. A second, independent layer behind the fence: publish-facilities.mjs
 *    is invoked as `--metro=<name>` and scopes with `.eq('metro_area', METRO)`, so a NULL keeps
 *    the row outside every metro-scoped run entirely. ADR-19 also scopes the directory to a
 *    defined list of 111 MSAs; assigning a metro we did not derive would be a fabricated
 *    assignment, not a convenience.
 *
 * 3. `verification_status` IS 'unverified'. ADR-18 pins the vocabulary: `human_verified` is
 *    reserved for a person's own sign-off and no script may write it; `source_verified` asserts a
 *    controlling entity confirmed the venue; `listed` asserts a credible local source named it
 *    with an address. A stranger's form submission is none of those.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
// Relative, not the `@/` alias: vitest.config.ts declares no path aliases, so an aliased import
// here fails at collection even though tsc and next resolve it fine. Every unit-tested module
// under lib/ imports its siblings this way.
import { directorySlug, nextAvailableSlug, randomSlugTail } from '../directory/slug'
import { omitUndefined, toCountryCode, toStateCode, type VenueDetail } from './submissionFields'

/** Batch tag. `facility_listings.source` is NOT NULL DEFAULT 'osm', so leaving it unset would file
 *  every user submission as OSM-ingested. It is also the non-destructive rollback handle:
 *  `update facility_listings set status='draft' where source='user-submission'`. */
export const USER_SUBMISSION_SOURCE = 'user-submission'

/** Postgres unique_violation. Raised on the `facility_listings_slug_key` constraint when two
 *  submissions race between the slug scan and the insert. */
const UNIQUE_VIOLATION = '23505'

export type ListingAddress = {
  name: string
  address: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  country: string | null
  lat?: number
  lng?: number
  google_place_id: string | null
  /** How the coordinate was obtained, recorded in provenance rather than asserted as fact. */
  coordinateSource: 'google_geocoding' | null
}

/**
 * Reads the slugs already taken under `base`, so the collision ladder only has to consider real
 * neighbours instead of the whole table.
 *
 * `like` needs its metacharacters escaped or a venue named "100%" would match far more than its
 * own family. The pattern is anchored at the start; a `base` that is a prefix of another venue's
 * slug simply returns a slightly larger set, which costs nothing.
 */
async function takenSlugsFor(db: SupabaseClient, base: string): Promise<Set<string>> {
  const escaped = base.replace(/[\\%_]/g, (c) => `\\${c}`)
  const { data, error } = await db
    .from('facility_listings')
    .select('slug')
    .like('slug', `${escaped}%`)
  // A failed read must not silently produce an empty set — that would hand back `base` as free and
  // convert a transient database error into a unique-violation on the insert.
  if (error) throw new Error(`slug availability read failed — ${error.message}`)
  return new Set((data ?? []).map((r: { slug: string }) => r.slug))
}

/**
 * Insert the listing, retrying once on a slug race.
 *
 * The scan above is a time-of-check/time-of-use window: two submissions of the same venue name in
 * the same city can both read the same free slug and both try to insert it. The retry re-reads the
 * taken set (now containing the winner's slug) and takes the next rung. A second failure falls
 * back to a random tail, which cannot realistically collide — a submission must never fail because
 * someone else submitted at the same moment.
 */
async function insertWithSlugRetry(
  db: SupabaseClient,
  row: Record<string, unknown>,
  base: string
): Promise<{ id: string; slug: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const taken = await takenSlugsFor(db, base)
    const slug = nextAvailableSlug(base, taken)
    const { data, error } = await db
      .from('facility_listings')
      .insert({ ...row, slug })
      .select('id, slug')
      .single()
    if (!error) return data as { id: string; slug: string }
    if (error.code !== UNIQUE_VIOLATION) {
      throw new Error(`facility listing insert failed — ${error.message}`)
    }
  }

  const slug = `${base}-${randomSlugTail()}`
  const { data, error } = await db
    .from('facility_listings')
    .insert({ ...row, slug })
    .select('id, slug')
    .single()
  if (error) throw new Error(`facility listing insert failed — ${error.message}`)
  return data as { id: string; slug: string }
}

/**
 * Create the draft listing for a submitted venue and return its id, so the caller can write it
 * onto `locations.facility_listing_id` (the ADR-13 bridge).
 */
export async function createFacilityListing(
  db: SupabaseClient,
  venue: ListingAddress,
  detail: VenueDetail,
  submittedBy: string
): Promise<{ id: string; slug: string }> {
  // NORMALIZE BEFORE THE SLUG IS DERIVED, not after — the state code is a slug segment, so
  // coercing it later would leave the URL carrying "…-nevada" while the column said "NV".
  //
  // Both of these are constraint-or-convention bugs that fail SILENTLY in opposite ways.
  // `country` violates a live CHECK (`char_length = 2`) and raises 23514, which is not 23505, so
  // insertWithSlugRetry does not retry — the caller catches, the location saves with a NULL bridge,
  // and every optional field the user filled in is gone with no error shown to them. `state`
  // violates nothing and saves happily as "Nevada", splitting the slug namespace against 2,365
  // rows that all use two letters. The first is loud in the logs and invisible to the user; the
  // second is invisible everywhere.
  const state = toStateCode(venue.state)
  const country = toCountryCode(venue.country)

  const base = directorySlug({ name: venue.name, city: venue.city, state })
  // directorySlug can only return '' when the name is empty, which the route rejects before here.
  if (!base) throw new Error('cannot derive a slug for this venue')

  const hasCoordinate = typeof venue.lat === 'number' && typeof venue.lng === 'number'

  const row = omitUndefined({
    name: venue.name,
    source: USER_SUBMISSION_SOURCE,
    status: 'draft', // never auto-published; the directory renders status='published' only
    address: venue.address,
    city: venue.city,
    state,
    zip: venue.zip_code,
    country,
    metro_area: null, // invariant 2
    google_place_id: venue.google_place_id,
    verification_status: 'unverified', // invariant 3
    // ADR-12: `address` needs compliant provenance, and a Places formatted_address is not a
    // storable source. The user reviews and submits editable fields, so the asserted source is the
    // person — which is what 'organizer' means in the pinned six-value vocabulary.
    address_source: venue.address ? 'organizer' : null,
    address_verified_at: venue.address ? new Date().toISOString() : null,
    ...(hasCoordinate ? { lat: venue.lat, lng: venue.lng } : {}),
    // provenance is the evidence trail and is NEVER rendered (ADR-14 — lib/directory/
    // loadFacilities.ts deliberately does not select it). `location_precision` is a GENERATED
    // column reading provenance.coordinate.precision, so the coordinate node below is what sets
    // it. Omit the node entirely when there is no coordinate: NULL precision means "no coordinate
    // node", which the publish gate treats differently from 'low'.
    provenance: {
      user_submission: {
        submitted_by: submittedBy,
        submitted_at: new Date().toISOString(),
        place_id: venue.google_place_id,
      },
      ...(hasCoordinate && venue.coordinateSource
        ? {
            coordinate: {
              precision: 'high',
              source: venue.coordinateSource,
              anchor: 'submitted address',
            },
          }
        : {}),
    },
    ...detail,
  })

  return insertWithSlugRetry(db, row, base)
}
