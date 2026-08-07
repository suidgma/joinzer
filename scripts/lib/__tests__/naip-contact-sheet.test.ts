/**
 * The two judgement calls the contact sheet makes — STALE and LIKELY-UNINFORMATIVE — plus the
 * blind-spot disclosure that has to survive every future edit to the renderer.
 *
 * The staleness rule is the one worth testing hardest: get it wrong in the permissive direction and
 * the tool generates false alarms on our newest and best venues, which is exactly the failure mode
 * it was built to prevent.
 */
import { describe, expect, it } from 'vitest'
import {
  stringValues, openingHintFromProvenance, endOfPeriod, stalenessVerdict, streetBandVerdict,
  uninformativeReasons, renderContactSheet,
} from '../naip-contact-sheet.mjs'

type Row = Record<string, any>

const strings = stringValues as (v: unknown) => string[]
const hint = openingHintFromProvenance as (p: unknown) => { opened: string; snippet: string } | null
const endOf = endOfPeriod as (s: unknown) => string | null
const staleness = stalenessVerdict as unknown as (a: Row) => Row
const band = streetBandVerdict as unknown as (a: Row) => Row
const uninformative = uninformativeReasons as unknown as (a: Row) => Row[]
const render = renderContactSheet as (a: Row) => string

describe('stringValues', () => {
  it('collects strings from anywhere in a nested structure, ignoring keys', () => {
    expect(strings({ a: 'one', b: { c: ['two', 3, null], d: { e: 'three' } } }).sort())
      .toEqual(['one', 'three', 'two'])
  })

  it('survives the shapes provenance actually holds', () => {
    expect(strings(null)).toEqual([])
    expect(strings(undefined)).toEqual([])
    expect(strings('bare')).toEqual(['bare'])
  })
})

describe('openingHintFromProvenance', () => {
  it('reads the real Manlius note', () => {
    // Verbatim from facility_listings.provenance.same_site_adjudication.note for
    // manlius-village-centre-field-manlius-ny. This is the whole premise of the automatic rule:
    // opening dates already live in research prose, written for an unrelated purpose.
    const provenance = {
      same_site_adjudication: {
        note: 'The Village of Manlius built SIX outdoor public courts on the old soccer field between Willowbrook Drive and the Manlius Village Centre, ribbon-cut July 2026 at just under $400,000 (Eagle News / CNY Central); the Manlius Recreation Center is the building itself and offers ONE indoor court, members only.',
        adjudicated_on: '2026-08-06',
      },
      imported_at: '2026-08-06T19:27:13.171Z',
    }
    expect(hint(provenance)?.opened).toBe('2026-07')
  })

  it('ignores machine dates, which is what keeps it from firing on every row', () => {
    // Every published row carries imported_at / artifact_updated / adjudicated_on. If an ISO date
    // could match BARE_YEAR, any note containing the word "opened" would date the venue to 2026.
    expect(hint({ imported_at: '2026-08-06T19:27:13.171Z', artifact_updated: '2026-08-06' })).toBeNull()
    expect(hint({ note: 'Courts opened to the public.', adjudicated_on: '2026-08-06' })).toBeNull()
  })

  it('requires the year to be NEAR an opening word, not merely in the same blob', () => {
    const far = 'The courts opened at dawn. ' + 'x'.repeat(400) + ' A survey conducted in 2011 covered the county.'
    expect(hint({ note: far })).toBeNull()
  })

  it('takes the LATEST opening a note asserts', () => {
    expect(hint({ note: 'The park was built in 1974; new pickleball courts were completed in 2024.' })?.opened).toBe('2024')
  })

  it('does not treat a resurface as an opening', () => {
    expect(hint({ note: 'The four courts were resurfaced in 2023.' })).toBeNull()
  })

  it('falls back to a bare year when the prose gives no month', () => {
    expect(hint({ note: 'Grand opening 2021 per the parks department.' })?.opened).toBe('2021')
  })
})

describe('endOfPeriod', () => {
  it('expands a partial date to its last possible day', () => {
    expect(endOf('2026')).toBe('2026-12-31')
    expect(endOf('2026-07')).toBe('2026-07-31')
    expect(endOf('2026-02')).toBe('2026-02-28')
    expect(endOf('2024-02')).toBe('2024-02-29') // leap year
    expect(endOf('2026-07-04')).toBe('2026-07-04')
  })

  it('returns null for junk rather than a date it invented', () => {
    expect(endOf('soon')).toBeNull()
    expect(endOf('')).toBeNull()
    expect(endOf(null)).toBeNull()
  })
})

describe('stalenessVerdict', () => {
  it('fires on the pilot case: 2019 imagery, courts opened July 2026', () => {
    const v = staleness({ imageryDate: '2019-08-02', opened: '2026-07', openedSource: 'provenance' })
    expect(v.stale).toBe(true)
    expect(v.reason).toContain('2019-08-02')
    expect(v.reason).toContain('read from research prose')
  })

  it('does not fire when the flight is after the opening', () => {
    expect(staleness({ imageryDate: '2023-05-09', opened: '2021', openedSource: 'curated' }).stale).toBe(false)
  })

  it('flags a same-year ambiguity rather than calling it clean', () => {
    // A venue that opened some time in 2019 and an August 2019 flight: the crop may or may not show
    // it. That uncertainty is precisely what a reviewer should be routed to, so it flags.
    expect(staleness({ imageryDate: '2019-08-02', opened: '2019' }).stale).toBe(true)
    // ...but a flight AFTER the last possible opening day is clean.
    expect(staleness({ imageryDate: '2020-01-05', opened: '2019' }).stale).toBe(false)
  })

  it('cannot fire without both facts — an unknown opening is not a stale one', () => {
    expect(staleness({ imageryDate: '2019-08-02', opened: null }).stale).toBe(false)
    expect(staleness({ imageryDate: null, opened: '2026-07' }).stale).toBe(false)
  })
})

describe('streetBandVerdict', () => {
  /** Verbatim `provenance.coordinate` shape, as read off the four published Syracuse rows. */
  const coord = (over: Row = {}): Row => ({
    coordinate: {
      lat: 43.1228399,
      lng: -76.1386095,
      anchor: 'highway/secondary way/343907770 "East Taft Road" (query rung: address)',
      origin: 'nominatim',
      precision: 'low',
      source_url: 'https://nominatim.openstreetmap.org/',
      name_anchor: null,
      adopted_from: null,
      matched_rung: 'address',
      address_override: null,
      shared_anchor_with: null,
      workbook_crosscheck: null,
      ...over,
    },
  })

  it('fires on the pilot signature: low + address rung + a ROAD anchor', () => {
    const v = band({ precision: 'low', provenance: coord() })
    expect(v.streetBand).toBe(true)
    expect(v.reason).toContain('STREET-BAND ANCHOR')
    expect(v.anchor).toContain('East Taft Road')
  })

  // THE CLAUSE THAT REPLACED `osm_id IS NULL`. Both of these are REAL published rows the old rule
  // flagged as street bands, and neither is on a road: the badge asserted "the crosshair is on a road
  // centreline by construction" about a municipal boundary centroid and about a bookstore node. They
  // are still bad pins — they are simply not this class, and the reviewer action for them differs.
  it.each([
    ['a municipal boundary centroid', 'boundary/administrative relation/179859 "Carrboro" (query rung: address)'],
    ['a named different entity at the right house number', 'shop/books node/5329612301 "UNF Bookstore", house number 1 (query rung: address)'],
  ])('does NOT fire on %s, which the osm_id proxy mislabelled as a street band', (_label, anchor) => {
    expect(band({ precision: 'low', provenance: coord({ anchor }) }).streetBand).toBe(false)
  })

  // THE REGRESSION THAT MOTIVATED THE REPAIR. `geocodeVenue` returns an osm_id and a street band is a
  // real OSM way, so the old clause rejected the exact pins it was written to catch the moment the
  // rule was asked about an EXTRACT-TIME coordinate rather than a published row. The importer's field
  // list drops osm_id, which is the only reason that never showed up against the database.
  it('fires on a road anchor that carries an osm_id — the extract-time shape', () => {
    expect(band({
      precision: 'low',
      provenance: coord({ osm_id: 'way/343907770' }),
    }).streetBand).toBe(true)
  })

  // THE 3-vs-1 SPLIT, pinned. Onondaga Lake Park Pickleball Complex is the venue whose empty crop is
  // explained by a 2026 build under 2019 imagery, NOT by a bad pin. It came off the same `address`
  // rung with no osm_id — the ONLY thing separating it is precision, so precision is the clause that
  // has to hold. A rule that flags this row sends a reviewer to "fix" a correct coordinate.
  it('does NOT fire on the high-precision house-number anchor that under-fired in the pilot', () => {
    expect(band({
      precision: 'high',
      provenance: coord({
        anchor: 'place/house node/8787518638, house number 106 (query rung: address)',
        precision: 'high',
        adopted_from: undefined,
      }),
    }).streetBand).toBe(false)
  })

  it('does not fire on a low pin that came off a NAME rung — that is a feature, not a street', () => {
    expect(band({ precision: 'low', provenance: coord({ matched_rung: 'name_city_state' }) }).streetBand).toBe(false)
  })

  // What a repair actually produces: adoption resolves a leisure/pitch and the anchor stops being a
  // road. The osm_id is incidental to that — the anchor is what changed.
  it('does not fire once the anchor is a venue feature, which is what a repair produces', () => {
    expect(band({
      precision: 'low',
      provenance: coord({ anchor: 'leisure/pitch way/123456 "Skyway Park Pickleball Courts" (query rung: osm-feature-lookup)' }),
    }).streetBand).toBe(false)
  })

  it('survives the rows that carry no coordinate provenance at all', () => {
    expect(band({ precision: 'low', provenance: null }).streetBand).toBe(false)
    expect(band({ precision: null, provenance: undefined }).streetBand).toBe(false)
    expect(band({ precision: 'low', provenance: {} }).streetBand).toBe(false)
  })
})

describe('uninformativeReasons', () => {
  it('flags a point with no NAIP coverage', () => {
    expect(uninformative({ imageryDate: null, indoor: false, stale: false }).map((r) => r.code)).toEqual(['no-imagery'])
  })

  it('flags an indoor venue — a roof from above proves nothing', () => {
    expect(uninformative({ imageryDate: '2019-08-02', indoor: true, stale: false }).map((r) => r.code)).toEqual(['indoor'])
  })

  it('flags a street-band pin, with its own code rather than folded into stale', () => {
    expect(uninformative({ imageryDate: '2019-08-02', indoor: false, stale: false, streetBand: true }).map((r) => r.code))
      .toEqual(['street-band'])
  })

  it('does NOT flag a low-precision coordinate', () => {
    // Deliberate: `low` ALONE is where a gross error is MOST likely and the crop may still show the
    // venue (a park centroid is `low` and usually lands inside the park). Only the full three-clause
    // street-band signature says the pin is on a road. The sheet shows precision as a neutral badge.
    expect(uninformative({ imageryDate: '2019-08-02', indoor: false, stale: false })).toEqual([])
  })

  it('accumulates every applicable reason', () => {
    expect(uninformative({ imageryDate: null, indoor: true, stale: true, streetBand: true }).map((r) => r.code))
      .toEqual(['no-imagery', 'stale', 'street-band', 'indoor'])
  })
})

describe('renderContactSheet', () => {
  const venue = (over: Row = {}): Row => ({
    name: 'Manlius Village Centre Field',
    slug: 'manlius-village-centre-field-manlius-ny',
    lat: 43.003299,
    lng: -75.9852624,
    precision: 'high',
    cropFile: 'crops/manlius-village-centre-field-manlius-ny.jpg',
    cropError: null,
    imageryDate: '2019-08-02',
    imageryDates: ['2019-08-02'],
    gsd: 0.6,
    gsdUnits: 'METER',
    stale: null,
    streetBand: null,
    uninformative: [],
    ...over,
  })
  const sheet = (venues: Row[]) => render({
    metro: 'Syracuse', venues, generatedAt: '2026-08-06 21:00 UTC', params: { groundMeters: 400, size: 667 },
  })

  it('states every blind spot IN THE PAGE, not only in the README', () => {
    const html = sheet([venue()])
    expect(html).toContain('CANNOT confirm court type')
    expect(html).toContain('CANNOT see anything built after the flight date')
    // [\s\S] rather than . with the /s flag — the repo's tsc target predates es2018, where /s is a
    // syntax error even though vitest itself runs the regex fine.
    expect(html).toMatch(/No courts visible[\s\S]{0,40}NOT[\s\S]{0,40}bad coordinate/)
  })

  it('shows the acquisition date and GSD on every cell', () => {
    const html = sheet([venue()])
    expect(html).toContain('2019-08-02')
    expect(html).toContain('0.6 meter')
  })

  it('surfaces a stale verdict on the cell it belongs to', () => {
    const html = sheet([venue({ stale: { stale: true, reason: 'imagery 2019-08-02 predates the venue&apos;s opening' } })])
    expect(html).toContain('badge stale')
    expect(html).toContain('is-stale')
  })

  it('escapes venue text rather than interpolating it raw', () => {
    const html = sheet([venue({ name: 'Foo <script>alert(1)</script> Park' })])
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('renders a cell with no crop instead of a broken image', () => {
    const html = sheet([venue({ cropFile: null, cropError: 'NAIP HTTP 500' })])
    expect(html).toContain('nocrop')
    expect(html).toContain('NAIP HTTP 500')
  })

  it('reports the imagery dates present, so the run is self-describing', () => {
    const html = sheet([venue(), venue({ slug: 'other', imageryDate: '2023-05-09', imageryDates: ['2023-05-09'] })])
    expect(html).toContain('2019-08-02, 2023-05-09')
  })

  const bandVenue = () => venue({
    precision: 'low',
    streetBand: { streetBand: true, anchor: 'highway/secondary way/343907770 "East Taft Road"', reason: 'STREET-BAND ANCHOR — needs a real anchor.' },
    uninformative: [{ code: 'street-band', text: 'pin is on a road centreline — the crop is not centred on the venue' }],
  })

  it('gives a street-band cell its own badge and its own cell class, distinct from stale', () => {
    const html = sheet([bandVenue()])
    expect(html).toContain('badge band')
    expect(html).toContain('is-band')
    expect(html).toContain('STREET-BAND ANCHOR')
    expect(html).toContain('East Taft Road')
    expect(html).not.toContain('badge stale')
  })

  it('offers a street-band filter and counts the class separately', () => {
    const html = sheet([bandVenue(), venue()])
    expect(html).toContain('data-hide="hide-band"')
    expect(html).toMatch(/street-band anchor: <b>1<\/b>/)
  })

  // The generic "hide likely-uninformative" sweep must not take the street-band cells with it — they
  // are the only class on the sheet that is fixable today, so burying them defeats the flag.
  it('exempts street-band cells from the generic uninformative hide rule', () => {
    expect(sheet([bandVenue()])).toContain('body.hide-dim .is-dim:not(.is-band)')
  })

  it('states in the page that STALE and STREET-BAND call for different actions', () => {
    const html = sheet([venue()])
    expect(html).toMatch(/STALE[\s\S]{0,120}new imagery/)
    expect(html).toMatch(/STREET-BAND[\s\S]{0,160}fixable today/)
  })
})
