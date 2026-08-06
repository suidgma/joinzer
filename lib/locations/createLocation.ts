import type { LocationOption } from '@/lib/types'

// A venue the user typed in because it isn't in the directory yet.
//
// The required half (name + address) is what the operational `locations` row needs. The optional
// half is venue detail for the canonical `facility_listings` record (ADR-13) — every field is
// nullable and a skipped field is persisted as NULL, never as 'unknown'. The server re-validates
// all of it against per-field allowlists (lib/locations/submissionFields.ts); these types describe
// the form's shape, they are not a trust boundary.
//
// Booleans are `boolean | null`, not `boolean`. Blank means "not answered" and must stay
// distinguishable from "no" — a false here would assert something the user never said.
export type NewLocationDetail = {
  court_count: string
  court_configuration: string
  indoor: boolean | null
  surface: string
  lighting: boolean | null
  line_type: string
  net_setup: string
  nets_provided_count: string
  access_type: string
  fee_type: string
  reservation_policy: string
  reservation_url: string
  website: string
  phone: string
  restrooms: boolean | null
  water_fountain: boolean | null
  accessibility: boolean | null
  parking: string
  public_notes: string
}

export type NewLocationDraft = {
  name: string
  address: string
  city: string
  state: string
  zip_code: string
  country: string
  /** Set only when the address came from Places autocomplete. The place_id is the one Places field
   *  we may persist (ADR-12 / GMP ToS §3.2.3); no other Places payload field is kept. */
  google_place_id: string
  detail: NewLocationDetail
}

export const emptyLocationDetail = (): NewLocationDetail => ({
  court_count: '',
  court_configuration: '',
  indoor: null,
  surface: '',
  lighting: null,
  line_type: '',
  net_setup: '',
  nets_provided_count: '',
  access_type: '',
  fee_type: '',
  reservation_policy: '',
  reservation_url: '',
  website: '',
  phone: '',
  restrooms: null,
  water_fountain: null,
  accessibility: null,
  parking: '',
  public_notes: '',
})

export const emptyLocationDraft = (): NewLocationDraft => ({
  name: '',
  address: '',
  city: '',
  state: '',
  zip_code: '',
  country: 'US',
  google_place_id: '',
  detail: emptyLocationDetail(),
})

/** True when the user filled in at least one optional field — drives the "N details added" hint. */
export function filledDetailCount(detail: NewLocationDetail): number {
  return Object.values(detail).filter((v) => v !== null && v !== '').length
}

// Create the location server-side and return it as a LocationOption. Throws on failure.
export async function createLocation(draft: NewLocationDraft): Promise<LocationOption> {
  // Flattened: the route reads the optional fields off the top level of the body, alongside the
  // required ones, so the wire shape stays one object rather than a nested `detail` the server
  // would have to reach into.
  const { detail, ...required } = draft
  const res = await fetch('/api/locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...required, ...detail }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.location) throw new Error(json.error ?? 'Failed to create location')
  return json.location as LocationOption
}
