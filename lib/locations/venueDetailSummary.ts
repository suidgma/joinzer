/**
 * Renders a submitted venue's detail as label/value pairs for the admin review queue.
 *
 * A field the submitter skipped is NULL and is OMITTED here rather than shown as "Unknown" or
 * "No". That distinction is the whole point of the NULL-vs-'unknown' rule on the write side: an
 * admin looking at this list should be able to tell "they said there are no restrooms" from "they
 * didn't say", because only the first is evidence.
 */

export type SubmittedVenueDetail = {
  court_count: number | null
  court_configuration: string | null
  indoor: boolean | null
  surface: string | null
  lighting: boolean | null
  line_type: string | null
  net_setup: string | null
  nets_provided_count: number | null
  access_type: string | null
  fee_type: string | null
  reservation_policy: string | null
  reservation_url: string | null
  website: string | null
  phone: string | null
  restrooms: boolean | null
  water_fountain: boolean | null
  accessibility: boolean | null
  parking: string | null
  public_notes: string | null
}

const LABELS: Record<string, string> = {
  dedicated: 'Dedicated pickleball',
  shared_multi_use: 'Shared / multi-use',
  mixed: 'Mixed',
  concrete: 'Concrete',
  asphalt: 'Asphalt',
  acrylic: 'Acrylic',
  sport_court: 'Sport court',
  wood: 'Wood',
  other: 'Other',
  permanent_painted: 'Permanent painted',
  temporary_provided: 'Temporary provided',
  byo_required: 'Bring your own',
  none: 'None',
  permanent: 'Permanent',
  portable_provided: 'Portable provided',
  shared_tennis_net: 'Shared tennis nets',
  public: 'Public',
  private: 'Private',
  membership: 'Membership',
  school: 'School',
  hoa: 'HOA',
  free: 'Free',
  fee: 'Pay to play',
  drop_in: 'Drop-in',
  reservation_recommended: 'Booking recommended',
  reservation_required: 'Booking required',
  lot: 'Parking lot',
  street: 'Street parking',
  unknown: 'Undetermined',
}

/** Field order mirrors the form's groups, so an admin reads them in the order they were asked. */
const FIELDS: { key: keyof SubmittedVenueDetail; label: string }[] = [
  { key: 'court_count', label: 'Courts' },
  { key: 'court_configuration', label: 'Setup' },
  { key: 'surface', label: 'Surface' },
  { key: 'indoor', label: 'Indoor' },
  { key: 'lighting', label: 'Lights' },
  { key: 'line_type', label: 'Lines' },
  { key: 'net_setup', label: 'Nets' },
  { key: 'nets_provided_count', label: 'Nets provided' },
  { key: 'access_type', label: 'Access' },
  { key: 'fee_type', label: 'Cost' },
  { key: 'reservation_policy', label: 'Booking' },
  { key: 'reservation_url', label: 'Booking link' },
  { key: 'website', label: 'Website' },
  { key: 'phone', label: 'Phone' },
  { key: 'restrooms', label: 'Restrooms' },
  { key: 'water_fountain', label: 'Water' },
  { key: 'parking', label: 'Parking' },
  { key: 'accessibility', label: 'Accessible' },
]

export type DetailEntry = { label: string; value: string; href?: string }

/** URL-valued fields become links; everything else is text. */
const LINK_FIELDS = new Set(['website', 'reservation_url'])

export function summarizeVenueDetail(
  detail: SubmittedVenueDetail | null | undefined
): { entries: DetailEntry[]; notes: string | null } {
  if (!detail) return { entries: [], notes: null }

  const entries: DetailEntry[] = []
  for (const { key, label } of FIELDS) {
    const raw = detail[key]
    if (raw === null || raw === undefined || raw === '') continue

    let value: string
    if (typeof raw === 'boolean') value = raw ? 'Yes' : 'No'
    else if (typeof raw === 'number') value = String(raw)
    else value = LABELS[raw] ?? raw

    entries.push({
      label,
      value,
      ...(LINK_FIELDS.has(key) && typeof raw === 'string' ? { href: raw } : {}),
    })
  }

  return { entries, notes: detail.public_notes?.trim() || null }
}
