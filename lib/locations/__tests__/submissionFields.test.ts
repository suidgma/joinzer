/**
 * The semantic rules these tests defend are easy to break and expensive to break:
 *
 *   - a skipped field must be NULL, never 'unknown' — 'unknown' claims someone researched it
 *   - a blank boolean must be NULL, never false — false claims the venue lacks the amenity
 *   - `access_type` alone is OMITTED when skipped, so the table default applies
 *   - no client string reaches the INSERT except through an allowlist
 *
 * A regression in any of these is silent: the row saves, the column has a plausible value, and the
 * directory's confidence data is quietly wrong.
 */
import { describe, expect, it } from 'vitest'
import {
  coerceVenueDetail,
  coerceTriStateBoolean,
  coerceUrl,
  clip,
  omitUndefined,
  ACCESS_TYPE,
  FEE_TYPE,
  RESERVATION_POLICY,
  COURT_CONFIGURATION,
  LINE_TYPE,
  NET_SETUP,
  PARKING,
  SURFACE,
} from '../submissionFields'

const ENUM_FIELDS = [
  { field: 'court_configuration', allowed: COURT_CONFIGURATION },
  { field: 'fee_type', allowed: FEE_TYPE },
  { field: 'reservation_policy', allowed: RESERVATION_POLICY },
  { field: 'line_type', allowed: LINE_TYPE },
  { field: 'net_setup', allowed: NET_SETUP },
  { field: 'parking', allowed: PARKING },
  { field: 'surface', allowed: SURFACE },
] as const

describe('the empty submission', () => {
  it('writes NULL for every optional field', () => {
    const { detail, errors } = coerceVenueDetail({})
    expect(errors).toEqual([])
    for (const [key, value] of Object.entries(detail)) {
      if (key === 'access_type') continue // omitted, not null — see below
      expect(value, `${key} should be null when not answered`).toBeNull()
    }
  })

  it('omits access_type so the table default applies', () => {
    const { detail } = coerceVenueDetail({})
    expect(detail.access_type).toBeUndefined()
    expect(omitUndefined({ ...detail })).not.toHaveProperty('access_type')
  })

  it('keeps every other null in the payload rather than dropping it', () => {
    // NULL is an explicit "not researched" and must be written; only `undefined` means "omit".
    const { detail } = coerceVenueDetail({})
    const payload = omitUndefined({ ...detail })
    expect(payload).toHaveProperty('fee_type', null)
    expect(payload).toHaveProperty('restrooms', null)
  })
})

describe("'unknown' is never writable from a submission", () => {
  it.each(ENUM_FIELDS)('rejects unknown on $field', ({ field }) => {
    const { detail } = coerceVenueDetail({ [field]: 'unknown' })
    expect(detail[field as keyof typeof detail]).toBeNull()
  })

  it('rejects unknown on access_type, leaving it omitted', () => {
    const { detail } = coerceVenueDetail({ access_type: 'unknown' })
    expect(detail.access_type).toBeUndefined()
  })

  it('rejects it whatever the casing or padding', () => {
    expect(coerceVenueDetail({ fee_type: '  UNKNOWN  ' }).detail.fee_type).toBeNull()
  })
})

describe('enum allowlists', () => {
  it.each(ENUM_FIELDS)('accepts every permitted value of $field', ({ field, allowed }) => {
    for (const value of allowed) {
      const { detail } = coerceVenueDetail({ [field]: value })
      expect(detail[field as keyof typeof detail]).toBe(value)
    }
  })

  it.each(ACCESS_TYPE)('accepts access_type %s', (value) => {
    expect(coerceVenueDetail({ access_type: value }).detail.access_type).toBe(value)
  })

  it.each(ENUM_FIELDS)('drops an unrecognized value on $field instead of failing', ({ field }) => {
    const { detail, errors } = coerceVenueDetail({ [field]: 'definitely-not-valid' })
    expect(detail[field as keyof typeof detail]).toBeNull()
    expect(errors).toEqual([])
  })

  it('normalizes case and surrounding whitespace', () => {
    expect(coerceVenueDetail({ fee_type: '  Free ' }).detail.fee_type).toBe('free')
  })

  it('does not accept a raw OSM surface tag the CHECK would permit', () => {
    // The column allows hard_court/tartan/ice/etc so already-ingested OSM rows validate. They are
    // ingest vocabulary, not answers to offer a person.
    for (const osmTag of ['hard', 'hard_court', 'paved', 'tartan', 'ice', 'grass', 'clay']) {
      expect(coerceVenueDetail({ surface: osmTag }).detail.surface).toBeNull()
    }
  })

  it('ignores a non-string value', () => {
    expect(coerceVenueDetail({ fee_type: 42 }).detail.fee_type).toBeNull()
    expect(coerceVenueDetail({ fee_type: { free: true } }).detail.fee_type).toBeNull()
  })
})

describe('tri-state booleans', () => {
  it('maps blank, absent and null to null — never false', () => {
    for (const value of ['', '   ', null, undefined]) {
      expect(coerceTriStateBoolean(value)).toBeNull()
    }
  })

  it('maps real answers through', () => {
    expect(coerceTriStateBoolean(true)).toBe(true)
    expect(coerceTriStateBoolean(false)).toBe(false)
    expect(coerceTriStateBoolean('true')).toBe(true)
    expect(coerceTriStateBoolean('false')).toBe(false)
    expect(coerceTriStateBoolean('yes')).toBe(true)
    expect(coerceTriStateBoolean('no')).toBe(false)
  })

  it('does not treat an unrecognized value as false', () => {
    // The bug this guards: falling back to `false` would assert the venue lacks the amenity.
    expect(coerceTriStateBoolean('maybe')).toBeNull()
    expect(coerceTriStateBoolean(0)).toBeNull()
    expect(coerceTriStateBoolean(1)).toBeNull()
  })

  it('applies to every boolean field on the payload', () => {
    const { detail } = coerceVenueDetail({
      indoor: 'yes',
      lighting: 'no',
      restrooms: '',
      water_fountain: 'nonsense',
    })
    expect(detail.indoor).toBe(true)
    expect(detail.lighting).toBe(false)
    expect(detail.restrooms).toBeNull()
    expect(detail.water_fountain).toBeNull()
    expect(detail.accessibility).toBeNull()
  })
})

describe('numeric fields reject rather than drop', () => {
  it('accepts a value inside the bounds', () => {
    const { detail, errors } = coerceVenueDetail({ court_count: 6, nets_provided_count: 0 })
    expect(detail.court_count).toBe(6)
    expect(detail.nets_provided_count).toBe(0)
    expect(errors).toEqual([])
  })

  it('accepts a numeric string, since that is what a number input submits', () => {
    expect(coerceVenueDetail({ court_count: '12' }).detail.court_count).toBe(12)
  })

  it('errors on an out-of-range court count', () => {
    const { detail, errors } = coerceVenueDetail({ court_count: 5000 })
    expect(detail.court_count).toBeNull()
    expect(errors[0]).toMatch(/between 1 and 200/)
  })

  it('rejects zero courts but allows zero nets', () => {
    expect(coerceVenueDetail({ court_count: 0 }).errors).toHaveLength(1)
    expect(coerceVenueDetail({ nets_provided_count: 0 }).errors).toEqual([])
  })

  it('errors on a non-integer', () => {
    expect(coerceVenueDetail({ court_count: 2.5 }).errors[0]).toMatch(/whole number/)
    expect(coerceVenueDetail({ court_count: 'six' }).errors[0]).toMatch(/whole number/)
  })

  it('errors on a negative net count', () => {
    // The column's CHECK is >= 0; catching it here keeps it a 400 instead of a 500.
    expect(coerceVenueDetail({ nets_provided_count: -1 }).errors).toHaveLength(1)
  })

  it('treats blank as not answered rather than as an error', () => {
    const { detail, errors } = coerceVenueDetail({ court_count: '', nets_provided_count: null })
    expect(detail.court_count).toBeNull()
    expect(errors).toEqual([])
  })

  it('rejects Infinity and NaN', () => {
    expect(coerceVenueDetail({ court_count: Infinity }).errors).toHaveLength(1)
    expect(coerceVenueDetail({ court_count: NaN }).errors).toHaveLength(1)
  })
})

describe('URL fields', () => {
  it('accepts http and https', () => {
    expect(coerceUrl('https://example.com/courts', 500)).toBe('https://example.com/courts')
    expect(coerceUrl('http://example.com/', 500)).toBe('http://example.com/')
  })

  it('rejects every scheme that is not http(s)', () => {
    // escape-html.ts is NOT a URL sanitizer — these contain no escapable character and would pass
    // straight through it into an href.
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)  ',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'ftp://example.com',
    ]) {
      expect(coerceUrl(bad, 500), bad).toBeNull()
    }
  })

  it('upgrades a bare hostname to https rather than losing the fact', () => {
    expect(coerceUrl('example.com/courts', 500)).toBe('https://example.com/courts')
  })

  it('rejects something that is not a hostname at all', () => {
    expect(coerceUrl('not a url', 500)).toBeNull()
    expect(coerceUrl('localhost', 500)).toBeNull()
    expect(coerceUrl('', 500)).toBeNull()
    expect(coerceUrl('   ', 500)).toBeNull()
  })

  it('applies to both URL fields on the payload', () => {
    const { detail } = coerceVenueDetail({
      website: 'javascript:alert(1)',
      reservation_url: 'https://book.example.com',
    })
    expect(detail.website).toBeNull()
    // Canonicalized by URL.toString() — a bare origin gains its root path.
    expect(detail.reservation_url).toBe('https://book.example.com/')
  })

  it('stores the canonical form, so the same site is not saved two ways', () => {
    // Worth pinning: it means a stored URL is comparable, and it is why the bare-origin case above
    // gains a trailing slash.
    expect(coerceUrl('https://example.com', 500)).toBe('https://example.com/')
    expect(coerceUrl('HTTPS://Example.COM/Courts', 500)).toBe('https://example.com/Courts')
  })

  it('caps the stored length', () => {
    const long = `https://example.com/${'a'.repeat(900)}`
    expect(coerceUrl(long, 500)?.length).toBe(500)
  })
})

describe('string clipping', () => {
  it('trims and caps', () => {
    expect(clip('  hello  ', 100)).toBe('hello')
    expect(clip('x'.repeat(50), 10)).toHaveLength(10)
  })

  it('maps blank to null', () => {
    expect(clip('   ', 10)).toBeNull()
    expect(clip('', 10)).toBeNull()
    expect(clip(undefined, 10)).toBeNull()
  })

  it('caps notes at 1000 and phone at 40', () => {
    const { detail } = coerceVenueDetail({
      public_notes: 'n'.repeat(2000),
      phone: 'p'.repeat(200),
    })
    expect(detail.public_notes).toHaveLength(1000)
    expect(detail.phone).toHaveLength(40)
  })
})

describe('omitUndefined', () => {
  it('drops undefined and keeps null', () => {
    expect(omitUndefined({ a: undefined, b: null, c: 1, d: false, e: '' })).toEqual({
      b: null,
      c: 1,
      d: false,
      e: '',
    })
  })
})

describe('a hostile payload', () => {
  it('cannot inject an unlisted value into any column', () => {
    const { detail } = coerceVenueDetail({
      access_type: "public'; drop table facility_listings; --",
      fee_type: 'human_verified',
      surface: 'ice',
      parking: 'valet',
      court_configuration: 'unknown',
      indoor: 'probably',
      website: 'javascript:fetch("/api")',
      court_count: '9999',
    })
    expect(detail.access_type).toBeUndefined()
    expect(detail.fee_type).toBeNull()
    expect(detail.surface).toBeNull()
    expect(detail.parking).toBeNull()
    expect(detail.court_configuration).toBeNull()
    expect(detail.indoor).toBeNull()
    expect(detail.website).toBeNull()
    expect(detail.court_count).toBeNull()
  })
})
