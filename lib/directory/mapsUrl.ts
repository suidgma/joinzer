import type { FacilityDetail } from './loadFacilities'

// Derive a Google Maps URL at render time (brief §2.6) — no maps URL is ever stored.
//
// Type-only import: erased at transform time, so this module never pulls loadFacilities.ts
// (and with it supabase-js + next/cache) into a runtime graph. Keeps the unit test trivial.
export type MapsUrlInput = Pick<
  FacilityDetail,
  'name' | 'address' | 'city' | 'state' | 'zip' | 'lat' | 'lng' | 'google_place_id'
>

const SEARCH_BASE = 'https://www.google.com/maps/search/?api=1&query='

/**
 * Fallback ladder, verified in a real browser 2026-07-30 (each rung was tested, not assumed):
 *
 *   1. place_id  → `query=<lat>,<lng>&query_place_id=<id>` — resolves to the venue's place card.
 *   2. address   → text query "<name>, <address>, <city>, <state> <zip>" — also resolves to the
 *      real place card (verified against the Cherry row, whose raw-coordinate URL rendered as
 *      the anonymous pin `29°12'40.8"N 81°02'29.9"W`).
 *   3. no address → raw `<lat>,<lng>`. Unnamed dropped pin, but at the CORRECT coordinate.
 *
 * Rung 3 keeps the old behavior on purpose. Two better-looking options were tested and both
 * fail dangerously:
 *   - "<name>, <city>, <state>" (no street address) mis-resolves. `Asante, Surprise, AZ` returns
 *     the Asante *neighborhood centroid*, ~1.8 km from the stored coordinate, rendered as an
 *     authoritative place card.
 *   - "<lat>,<lng> (<Name>)" is worse: the api=1 search endpoint ignores the coordinate entirely
 *     and text-searches the label. `33.701312,-112.402054 (Asante Pickleball Courts)` landed on a
 *     venue in Henderson, NV — different state, ~600 km away.
 *
 * The rows that reach rung 3 are disproportionately the HOA / active-adult class that ADR-14
 * records as the venue type Google Places systematically cannot surface — i.e. exactly the rows
 * where a text query is most likely to resolve confidently to the wrong place. An unnamed pin at
 * the right coordinate is honest; a place card 1.8 km away sends a player to the wrong address.
 * The real fix for these rows is a google_place_id backfill, not a cleverer URL.
 */
export function mapsUrl(f: MapsUrlInput): string | null {
  if (f.lat == null || f.lng == null) return null

  const coords = `${f.lat},${f.lng}`

  const placeId = f.google_place_id?.trim()
  if (placeId) {
    return `${SEARCH_BASE}${coords}&query_place_id=${encodeURIComponent(placeId)}`
  }

  const address = f.address?.trim()
  if (address) {
    // "<name>, <address>, <city>, <state> <zip>" — state and zip join with a space, not a comma,
    // so a missing zip can't leave a dangling separator.
    const region = [f.state?.trim(), f.zip?.trim()].filter(Boolean).join(' ')
    const query = [f.name?.trim(), address, f.city?.trim(), region].filter(Boolean).join(', ')
    return `${SEARCH_BASE}${encodeURIComponent(query)}`
  }

  return `${SEARCH_BASE}${coords}`
}
