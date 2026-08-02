import { describe, it, expect } from 'vitest'
import { visitorNotes, metaDescription } from '../publicNotes'

// Relative import, not '@/': there is no alias config for vitest, so a runtime '@/' import would
// fail here (type-only ones are erased and therefore fine — see lib/utils/__tests__).

// Every string below is a VERBATIM production value, pulled from facility_listings on 2026-08-01.
// Fixtures invented to match the regex would only prove the regex matches itself; these prove it
// handles the shapes the workbook pipeline actually produces.

/** Segment 0 is itself a machine `field: raw` pair — 87 published rows. Render nothing. */
const MACHINE_ONLY = [
  'surface: wood/tile', // Boston Recreation Center, Wichita (4 Wichita rows identical)
  'surface: hard/concrete', // Buffalo Park, Wichita
  'surface: hard asphalt', // D.F. Buchmiller County Park, Lancaster
  'surface: hard/indoor tennis overlay', // Ralph Wulz Riverside Tennis Center, Wichita
  'access type: senior program', // Bob Cecile Community Center, Syracuse
  'fee type: $2 guest fee', // Tony Rosa Community Center, Melbourne
  'fee type: donation suggested', // Indianola Activity Center, Des Moines
  'net setup: BYO/unspecified', // Walker Park, Fayetteville
  'reservation policy: open play and reservations', // Wilson Family YMCA, Augusta
  'court configuration: 6 dedicated outdoor + 4 lined outdoor + 8 lined indoor', // Towpath, Akron
  'fee type: paid reservation | reservation policy: reservation optional / programmed blocks',
  'court configuration: gym + tennis/pickleball courts | reservation policy: park open daily; indoor play schedule varies | lighting: outdoor courts lighted',
  'fee type: Free / rentals and programs may vary | reservation policy: Call pro shop for group reservations',
  'fee type: free / reservation fee may apply | reservation policy: first-come unless reserved',
]

/** Segment 0 leaks our schema or workflow — all 6 published rows that do. Render nothing. */
const INTERNALS = [
  'Current indoor open-play program; conflicting directory counts of one and three leave court_count null.',
  'Current facility identity is verified; conflicting directory counts of two and three leave court_count null.',
  'Current indoor pickleball, open play and rentals verified; court count remains null and address variants are preserved for recheck.',
  'Official location page explicitly advertises pickleball courts; unsupported configuration fields remain null.',
  'The city fitness center explicitly supports member pickleball; the court count remains blank because only secondary sources state two.',
  'Current City of Ozark communications identify tennis and pickleball play at the park; court count remains blank.',
]

/** Real visitor prose — the 435 rows this whole slice exists to surface. Render as-is. */
const VISITOR_PROSE = [
  'Three reservable outdoor courts with hourly pricing and equipment rental.',
  'City confirms 12 designated, lighted courts open to the public.',
  'Three indoor and three outdoor pickleball courts.',
  'City lists this park as under construction (picnic area and parking lot renovation, with a sports-court option). Confirm court availability before visiting.',
  'Pickleball lines striped on the tennis courts. Surrounding revitalization area has periodic closures.',
  'One basketball/pickleball court. Players may bring a net or rent the court and a net from the city.',
  'Current branch page lists recurring open play, member access, $15 guest pass, and equipment provided.',
  'Twenty-four lighted, dedicated pickleball courts at an 85-acre town park - one of the biggest public pickleball sites in the southeast Valley.',
]

describe('visitorNotes', () => {
  it('returns null for an absent value', () => {
    expect(visitorNotes(null)).toBeNull()
    expect(visitorNotes(undefined)).toBeNull()
    expect(visitorNotes('')).toBeNull()
    expect(visitorNotes('   ')).toBeNull()
  })

  describe('machine-appended field pairs are never rendered', () => {
    for (const raw of MACHINE_ONLY) {
      it(`suppresses ${JSON.stringify(raw.slice(0, 48))}`, () => {
        expect(visitorNotes(raw)).toBeNull()
      })
    }

    it('catches a field label this codebase has never seen', () => {
      // The rule tests the SHAPE (lowercase words + colon), not a list of the nine labels live
      // today, so a new workbook column cannot leak a raw value onto a public page.
      expect(visitorNotes('parking availability: gravel lot, unmarked')).toBeNull()
      expect(visitorNotes('water fountain: seasonal')).toBeNull()
    })
  })

  describe('database internals are never rendered', () => {
    for (const raw of INTERNALS) {
      it(`suppresses ${JSON.stringify(raw.slice(0, 48))}`, () => {
        expect(visitorNotes(raw)).toBeNull()
      })
    }
  })

  it('suppresses a bare fragment', () => {
    // 'Resort' — Westgate Las Vegas Resort & Casino and Plaza Hotel & Casino, 6 chars each.
    expect(visitorNotes('Resort')).toBeNull()
  })

  describe('real prose is returned unchanged', () => {
    for (const raw of VISITOR_PROSE) {
      it(`renders ${JSON.stringify(raw.slice(0, 48))}`, () => {
        expect(visitorNotes(raw)).toBe(raw)
      })
    }
  })

  describe('prose followed by a machine tail keeps only the prose', () => {
    // 29 published rows have this shape — real prose trapped in front of a raw dump. Dropping the
    // whole value would lose the sentence; rendering it whole would publish the dump.
    const cases: [string, string][] = [
      [
        'Lighted outdoor pickleball complex. | court configuration: 12 dedicated outdoor courts | reservation policy: Check posted programming',
        'Lighted outdoor pickleball complex.',
      ],
      [
        'Official facility page currently lists 16 outdoor and 3 indoor courts. | court configuration: 3 indoor shared + 16 outdoor dedicated | reservation policy: Indoor schedule; outdoor access under facility rules',
        'Official facility page currently lists 16 outdoor and 3 indoor courts.',
      ],
      [
        'Opened June 2026; 24 standard courts plus championship court. | court configuration: 25 covered dedicated outdoor courts | reservation policy: Open public play; programs may affect availability',
        'Opened June 2026; 24 standard courts plus championship court.',
      ],
      [
        '2026 denominational feature confirms active community pickleball ministry with painted overlay lines; schedule directory reports three indoor courts. | fee type: community program | court configuration: overlay gym | surface: indoor gym',
        '2026 denominational feature confirms active community pickleball ministry with painted overlay lines; schedule directory reports three indoor courts.',
      ],
    ]

    for (const [raw, expected] of cases) {
      it(`keeps ${JSON.stringify(expected.slice(0, 40))}`, () => {
        expect(visitorNotes(raw)).toBe(expected)
      })
    }
  })

  it('never returns a value containing the machine delimiter', () => {
    // The property the e2e spec asserts against the rendered DOM, asserted here against the source.
    for (const raw of [...MACHINE_ONLY, ...INTERNALS, ...VISITOR_PROSE]) {
      expect(visitorNotes(raw) ?? '').not.toContain('|')
    }
  })

  it('preserves punctuation and dashes that appear in real notes', () => {
    // 39 rows carry an en/em dash; one carries straight quotes. Nothing here normalizes text.
    const raw =
      'Drop-in play is offered at $15/day, 7am-5pm Mon-Thu, "until membership full" per the operator — public access here has a known expiry.'
    expect(visitorNotes(raw)).toBe(raw)
  })

  it('trims surrounding whitespace but nothing inside', () => {
    expect(visitorNotes('  Three indoor and three outdoor pickleball courts.  ')).toBe(
      'Three indoor and three outdoor pickleball courts.'
    )
  })
})

describe('metaDescription', () => {
  it('returns null for an absent value', () => {
    expect(metaDescription(null)).toBeNull()
    expect(metaDescription(undefined)).toBeNull()
  })

  it('returns short text unchanged, with no ellipsis', () => {
    const short = 'Three reservable outdoor courts with hourly pricing and equipment rental.'
    expect(metaDescription(short)).toBe(short)
    expect(metaDescription(short)).not.toContain('…')
  })

  it('truncates on a word boundary and never mid-word', () => {
    const long =
      'Twenty-four lighted, dedicated pickleball courts at an 85-acre town park - one of the biggest public pickleball sites in the southeast Valley. Sixteen of the courts are open play on a first-come, first-served basis.'
    const out = metaDescription(long)!

    expect(out.length).toBeLessThanOrEqual(155)
    expect(out.endsWith('…')).toBe(true)
    // The character before the ellipsis ends a whole word that the source actually contains.
    const body = out.slice(0, -1)
    expect(long.startsWith(body)).toBe(true)
    expect(long[body.length]).toBe(' ')
  })

  it('never exceeds the limit, including the ellipsis', () => {
    for (const limit of [60, 100, 155, 200]) {
      const out = metaDescription('word '.repeat(200), limit)!
      expect(out.length).toBeLessThanOrEqual(limit)
    }
  })

  it('does not leave dangling punctuation before the ellipsis', () => {
    const out = metaDescription(
      'Pickleball runs in two places here: reservable outdoor sport courts, and the indoor multipurpose gym which is open on weekends only.',
      60
    )!
    expect(out).not.toMatch(/[\s,;:.—-]…$/)
  })

  it('hard-slices a single word longer than the limit rather than returning nothing', () => {
    const out = metaDescription('x'.repeat(400), 50)!
    expect(out.length).toBe(50)
    expect(out.endsWith('…')).toBe(true)
  })
})
