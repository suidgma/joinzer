/**
 * Server-side validation for the optional venue detail a user may attach to a submitted location.
 *
 * Every field here targets an existing `facility_listings` column with a live CHECK constraint.
 * Nothing in this module is a passthrough: each value is looked up in an allowlist declared below,
 * so a client string can never reach the INSERT. That is not defensive style for its own sake — a
 * value outside a CHECK constraint makes the insert fail atomically, which would turn a typo in
 * the client into a 500 on a user's submission.
 *
 * TWO SEMANTIC RULES GOVERN THE WHOLE FILE. Both are easy to get backwards and both corrupt the
 * directory's confidence data when you do.
 *
 * 1. NULL means "not yet researched". `'unknown'` means "researched and undetermined".
 *    A user who skips a field has told us nothing, so a skipped field writes NULL — never
 *    `'unknown'`, even though the CHECK constraints permit it. `'unknown'` is not offered in the
 *    UI and is rejected here if a client sends it anyway.
 *
 *    ONE DELIBERATE EXCEPTION: `access_type`. That column is nullable but carries a non-NULL
 *    table default (`'unknown'`) and has zero NULL rows across all 2,364 listings — NULL is a
 *    state it has never held. So a skipped `access_type` is OMITTED from the payload and the
 *    table default applies, rather than writing a NULL this column has no precedent for.
 *    `coerceVenueDetail` models that with `undefined` (omit) as distinct from `null` (write NULL).
 *    The asymmetry is intentional; it is not an oversight to tidy up.
 *
 * 2. A BOOLEAN IS TRI-STATE, and a checkbox cannot express it. An unchecked box submits `false`,
 *    which asserts "this venue has no restrooms" — a claim the user never made. The UI uses
 *    Yes / No / blank selects and blank arrives here as null/undefined, which writes NULL.
 */

/** Only these two schemes may be persisted to a URL column. `lib/utils/escape-html.ts` says in its
 *  own header that it is NOT a URL sanitizer: `javascript:` and `data:` contain no escapable
 *  character and pass straight through it, so the scheme check has to happen here. */
const SAFE_URL_SCHEMES = new Set(['http:', 'https:'])

/** The value meaning "researched and undetermined". Never writable from a user submission. */
const RESEARCHED_BUT_UNDETERMINED = 'unknown'

// ── Allowlists ────────────────────────────────────────────────────────────────────────────────
// Each is a strict subset of its column's live CHECK constraint, with 'unknown' removed.

export const ACCESS_TYPE = ['public', 'private', 'membership', 'school', 'hoa'] as const
export const FEE_TYPE = ['free', 'fee', 'membership'] as const
export const RESERVATION_POLICY = [
  'none',
  'drop_in',
  'reservation_recommended',
  'reservation_required',
] as const
export const COURT_CONFIGURATION = ['dedicated', 'shared_multi_use', 'mixed'] as const
export const LINE_TYPE = [
  'permanent_painted',
  'temporary_provided',
  'byo_required',
  'none',
  'mixed',
] as const
export const NET_SETUP = [
  'permanent',
  'portable_provided',
  'shared_tennis_net',
  'byo_required',
  'none',
  'mixed',
] as const
export const PARKING = ['lot', 'street', 'none'] as const

/**
 * A deliberate 6-value subset of the column's 16-value CHECK. The full constraint also permits
 * raw OSM surface tags (`hard`, `hard_court`, `paved`, `tartan`, `ground`, `artificial_turf`,
 * `rubber`, `clay`, `grass`, `ice`) which exist so already-ingested OSM rows validate. They are
 * ingest vocabulary, not answers to ask a person for, and `ice`/`grass` are known mistags that a
 * previous migration cleaned up. Widening this list re-opens that.
 */
export const SURFACE = ['concrete', 'asphalt', 'acrylic', 'sport_court', 'wood', 'other'] as const

/** Nobody has 200 pickleball courts. The bound exists to reject a fat-fingered or scripted value
 *  loudly rather than storing it and letting it skew a future court-count sort. */
const MAX_COURTS = 200

export type VenueDetail = {
  court_count: number | null
  court_configuration: string | null
  indoor: boolean | null
  surface: string | null
  lighting: boolean | null
  line_type: string | null
  net_setup: string | null
  nets_provided_count: number | null
  /** `undefined` = omit from the payload so the table default 'unknown' applies. See rule 1. */
  access_type: string | undefined
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

/**
 * Pick a value out of an allowlist. Anything unrecognized — including `'unknown'` — becomes NULL.
 *
 * NULL rather than a 400, deliberately. The UI only ever offers allowlisted values, so an
 * unrecognized one means a stale client or a hand-crafted request, and neither is worth failing a
 * whole venue submission over. Dropping the field loses one optional fact; rejecting the request
 * loses the venue. The numeric fields below DO reject, because a user who typed a court count can
 * see it was wrong and fix it.
 */
function pickEnum<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  if (typeof value !== 'string') return null
  const v = value.trim().toLowerCase()
  if (!v || v === RESEARCHED_BUT_UNDETERMINED) return null
  return (allowed as readonly string[]).includes(v) ? (v as T[number]) : null
}

/**
 * Tri-state boolean. Blank, absent, null and any unrecognized value all mean "not answered" → NULL.
 * Never coerce a falsy value to `false`; see rule 2 in the header.
 */
export function coerceTriStateBoolean(value: unknown): boolean | null {
  if (value === true || value === false) return value
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === 'true' || v === 'yes') return true
    if (v === 'false' || v === 'no') return false
  }
  return null
}

/** Bounded integer. Returns an error string instead of silently dropping — the user typed this. */
function coerceInteger(
  value: unknown,
  label: string,
  min: number,
  max: number,
  errors: string[]
): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    errors.push(`${label} must be a whole number`)
    return null
  }
  if (n < min || n > max) {
    errors.push(`${label} must be between ${min} and ${max}`)
    return null
  }
  return n
}

/**
 * Accept a URL only if it parses AND its scheme is http/https. A bare "example.com" is upgraded to
 * https rather than rejected, because a user typing a website without a scheme is the common case
 * and refusing it would lose a good fact over a formatting detail.
 */
export function coerceUrl(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return null
  }
  if (!SAFE_URL_SCHEMES.has(parsed.protocol)) return null
  if (!parsed.hostname || !parsed.hostname.includes('.')) return null
  return parsed.toString().slice(0, max)
}

/**
 * ISO-3166-1 alpha-2, or NULL.
 *
 * NOT COSMETIC — `facility_listings_country_chk` is `char_length(country) = 2`, so anything longer
 * raises 23514 and takes the whole insert with it. The form's Country input carries
 * `autoComplete="country-name"`, which is precisely the token a browser autofills with
 * "United States", so the failing value is the DEFAULT one for anybody with autofill on.
 *
 * The alias table is deliberately tiny. It covers what a US/Canada/Mexico pickleball form actually
 * receives from autofill; anything else falls through to NULL rather than being guessed at, because
 * a wrong country code is worse than a missing one and this is an optional column.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  'u s a': 'US',
  'u s': 'US',
  america: 'US',
  canada: 'CA',
  mexico: 'MX',
  'united kingdom': 'GB',
  'great britain': 'GB',
}

/**
 * Letters only. A code check on this rather than on the raw string is what lets "U.S.", "N.Y." and
 * "N V" resolve — a user typing an abbreviation with periods has given us the code, and refusing it
 * over punctuation would drop a fact for no reason.
 */
function lettersOnly(raw: string): string {
  return raw.replace(/[^a-z]/gi, '')
}

/** Words, for the lookup tables. "U.S.A." → "u s a", "New  York" → "new york". */
function lookupKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z]+/g, ' ').trim()
}

export function toCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  const letters = lettersOnly(raw)
  if (letters.length === 2) return letters.toUpperCase()
  return COUNTRY_ALIASES[lookupKey(raw)] ?? null
}

/**
 * USPS two-letter state code, or NULL.
 *
 * `facility_listings.state` has no CHECK, so a full name would save — and that is the problem:
 * all 2,365 live rows use the two-letter convention, and `directorySlug` puts this straight into
 * the URL. "Nevada" would mint `sunset-park-las-vegas-nevada` beside `…-las-vegas-nv`, splitting
 * the namespace with no error anywhere. The Places path already supplies the code
 * (`administrative_area_level_1` short_name); this exists for the free-text fallback.
 *
 * AN UNMAPPABLE VALUE BECOMES NULL, NOT THE RAW STRING. Nothing is actually lost: the operational
 * `locations` row stores what the user typed verbatim, and `/admin/locations` renders it, so a
 * reviewer still sees "Nevada" — it just never reaches the canonical record or the slug.
 */
const US_STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  'district of columbia': 'DC', 'washington dc': 'DC', 'washington d c': 'DC',
  'puerto rico': 'PR', 'virgin islands': 'VI', guam: 'GU',
  'american samoa': 'AS', 'northern mariana islands': 'MP',
}

export function toStateCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  // Name lookup FIRST, because a two-letter name would otherwise be shadowed by the code path.
  // No US state name is two letters today, but ordering it this way means a future entry cannot
  // be silently misread as a code.
  const named = US_STATES[lookupKey(raw)]
  if (named) return named
  const letters = lettersOnly(raw)
  if (letters.length === 2) return letters.toUpperCase()
  return null
}

/** Trim + cap a client string; empty → null. Mirrors the `clip` already used by the route. */
export function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t ? t.slice(0, max) : null
}

/**
 * Coerce a request body into the venue detail we are willing to persist.
 *
 * Returns the detail plus any errors worth failing the request over. Errors are only ever raised
 * by the numeric fields — see `pickEnum` for why the enums drop instead.
 */
export function coerceVenueDetail(body: Record<string, unknown>): {
  detail: VenueDetail
  errors: string[]
} {
  const errors: string[] = []

  const access = pickEnum(body.access_type, ACCESS_TYPE)

  const detail: VenueDetail = {
    court_count: coerceInteger(body.court_count, 'Number of courts', 1, MAX_COURTS, errors),
    court_configuration: pickEnum(body.court_configuration, COURT_CONFIGURATION),
    indoor: coerceTriStateBoolean(body.indoor),
    surface: pickEnum(body.surface, SURFACE),
    lighting: coerceTriStateBoolean(body.lighting),
    line_type: pickEnum(body.line_type, LINE_TYPE),
    net_setup: pickEnum(body.net_setup, NET_SETUP),
    nets_provided_count: coerceInteger(
      body.nets_provided_count,
      'Nets provided',
      0,
      MAX_COURTS,
      errors
    ),
    // undefined, not null — omitted from the payload so the table default applies. See rule 1.
    access_type: access ?? undefined,
    fee_type: pickEnum(body.fee_type, FEE_TYPE),
    reservation_policy: pickEnum(body.reservation_policy, RESERVATION_POLICY),
    reservation_url: coerceUrl(body.reservation_url, 500),
    website: coerceUrl(body.website, 500),
    phone: clip(body.phone, 40),
    restrooms: coerceTriStateBoolean(body.restrooms),
    water_fountain: coerceTriStateBoolean(body.water_fountain),
    accessibility: coerceTriStateBoolean(body.accessibility),
    parking: pickEnum(body.parking, PARKING),
    public_notes: clip(body.public_notes, 1000),
  }

  return { detail, errors }
}

/**
 * Strip the keys whose value is `undefined` so they are omitted from the INSERT and the column
 * default applies. `null` survives — it is an explicit "not researched" and must be written.
 */
export function omitUndefined<T extends Record<string, unknown>>(row: T): Partial<T> {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as Partial<T>
}
