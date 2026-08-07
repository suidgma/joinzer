/**
 * COORDINATE ADOPTION — `venue_facts.<key>.coordinate`.
 *
 * The gap: nothing in the pipeline could set a coordinate. `venue_facts.fields` throws outside its
 * nine evidence-bearing fields, a workbook coordinate is never a source, and the two
 * coordinate-changing levers cannot be aimed at an OSM feature carrying neither a house number on
 * its street nor a name the ladder queries. Orlando's AdventHealth complex published 407 m away on a
 * street band as a result.
 *
 * What these tests pin is the SAFETY ARGUMENT, not the happy path: the config states an OSM feature
 * IDENTIFIER and never a coordinate, precision is CLASSIFIED rather than asserted, and all four
 * guards fail closed with no acknowledgement flag and no per-metro override anywhere.
 *
 * Guards are patched into an IN-MEMORY config and `extractWorkbook` is called directly — throwaway
 * `scripts/metros/_vt_*.json` files are permanent litter in this harness (`rm` is permission-gated)
 * and one stray config in that directory is a live hazard.
 */
import { describe, expect, it } from 'vitest'
import { extractWorkbook } from '../workbook-extract.mjs'

type Row = Record<string, any>

const VENUE_NAME = 'AdventHealth Pickleball Complex at Central Winds Park'
const EVIDENCE = 'https://www.openstreetmap.org/way/1165951096'
const LICENCE = 'Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright'

/** The courts themselves: a named leisure/pitch at the venue's own house number. Classifies `high`. */
const COURTS = {
  licence: LICENCE,
  osm_type: 'way',
  osm_id: 1165951096,
  lat: '28.7075117',
  lon: '-81.2750142',
  category: 'leisure',
  type: 'pitch',
  name: 'Central Winds Pickleball Courts',
  namedetails: { name: 'Central Winds Pickleball Courts' },
  address: { house_number: '1000', road: 'Hicks Avenue;Oviedo Road', town: 'Winter Springs', postcode: '32708' },
}

/** The street band the ordinary ladder lands on — 407 m away, precision `low`. */
const STREET = {
  licence: LICENCE,
  osm_type: 'way',
  osm_id: 645260772,
  lat: '28.7073709',
  lon: '-81.2708528',
  category: 'highway',
  type: 'residential',
  name: 'Central Winds Parkway',
  namedetails: { name: 'Central Winds Parkway' },
  address: { road: 'Central Winds Parkway', town: 'Winter Springs' },
}

/** A same-named park 14 km away — the Koons Park trap, in adoption form. */
const FAR_AWAY = { ...COURTS, osm_id: 111, lat: '28.8300000', lon: '-81.2750142' }

/**
 * Routes every request by URL: `/lookup` gets the adopted feature, `/search` gets the street band.
 * No network, no 1.1 s waits. Counts lookups so "one adoption costs one request" is a checked fact.
 */
function net(lookupPayload: unknown, searchPayload: unknown = [STREET]) {
  const calls = { lookup: 0, search: 0 }
  const fetchImpl = async (url: URL | string) => {
    const s = String(url)
    const isLookup = s.includes('/lookup')
    isLookup ? calls.lookup++ : calls.search++
    const payload = isLookup ? lookupPayload : searchPayload
    return {
      ok: true, status: 200, statusText: 'OK',
      headers: { get: () => null },
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as any
  }
  return { fetchImpl, calls }
}

/**
 * NO ADDRESS COLUMN, DELIBERATELY — and it is about test runtime, not about coverage.
 *
 * The >=1.1 s endpoint spacing is NOT injectable (geocode-nominatim.mjs says why: a test-only bypass
 * of someone else's courtesy limit is the kind of seam that later leaks into a real run), so tests
 * pay the real wait. With an address, this fixture drives the full ladder plus the township rung —
 * four rungs, two locus queries, a bare-name query and a no-city retry — because nothing it returns
 * ever classifies `high` and only a `high` short-circuits. That is ~9 s per test before the lookup.
 *
 * Dropping the address leaves exactly ONE name rung, and costs the scenario nothing: the superseded
 * anchor is still a `low` street band and the adopted feature still classifies `high` (with no house
 * number to match, `leisure` + nameOverlap carries it). The address ladder is exercised at length in
 * geocode-fallback-rungs.test.ts; what is under test here is adoption.
 */
const tabs = () => ({
  'Import Ready': [
    ['research_key', 'name', 'city', 'state', 'access_type', 'fee_type', 'research_status', 'website'],
    ['orl-adventhealth', VENUE_NAME, 'Winter Springs', 'FL', 'public', 'free', 'probable', 'https://www.winterspringsfl.org/'],
  ],
})

const baseConfig = {
  metro: 'unit-test', batch: 'unit-test', metro_area: 'Testville', states: ['FL'],
  workbook: { header_row: 1 },
}

/** A well-formed adoption entry. Individual guards are exercised by omitting or bending one key. */
const adoption = (over: Row = {}, specOver: Row = {}) => ({
  venue_facts: {
    'orl-adventhealth': {
      adjudicated_by: 'feature-builder',
      adjudicated_on: '2026-08-06',
      ...specOver,
      coordinate: {
        osm_id: 'way/1165951096',
        expect_lat: 28.7075117,
        expect_lng: -81.2750142,
        evidence_url: EVIDENCE,
        reason: 'OSM carries the courts as a named leisure/pitch feature the query ladder cannot reach.',
        ...over,
      },
    },
  },
})

const extract = extractWorkbook as unknown as (a: Row) => Promise<{ venues: Row[] } & Row>
const cachePath = () => `${process.env.TEMP || '/tmp'}/joinzer-adopt-${process.pid}-${Math.random().toString(36).slice(2)}.json`
const run = (config: Row, stub: ReturnType<typeof net>) =>
  extract({ tabs: tabs(), config, geocode: true, cachePath: cachePath(), log: () => {}, fetchImpl: stub.fetchImpl })

/** Two live-shaped requests per test at the module's real >=1.1 s spacing, plus headroom. Raised
 *  explicitly rather than by making the courtesy timer injectable — the tests pay the wait. */
const SLOW = 20_000

describe('coordinate adoption — happy path', () => {
  it('replaces the street band with the courts and lets the CLASSIFIER decide precision', async () => {
    const stub = net([COURTS])
    const doc = await run({ ...baseConfig, ...adoption() }, stub)
    const c = doc.venues[0].coordinates

    // The whole point: low street band -> high on the courts themselves. `high` is earned by the
    // untouched classifier (house number + nameOverlap), never asserted by the config.
    expect(c.precision).toBe('high')
    expect(c.lat).toBeCloseTo(28.7075117, 7)
    expect(c.lng).toBeCloseTo(-81.2750142, 7)
    expect(c.origin).toBe('nominatim')
    expect(c.matched_rung).toBe('osm-feature-lookup')
    expect(stub.calls.lookup).toBe(1)
  }, SLOW)

  it('records the full adjudication, the superseded pin and both re-derived distances', async () => {
    const doc = await run({ ...baseConfig, ...adoption() }, net([COURTS]))
    const a = doc.venues[0].coordinates.adopted_from

    expect(a.osm_id).toBe('way/1165951096')
    expect(a.osm_feature_name).toBe('Central Winds Pickleball Courts')
    expect(a.evidence_url).toBe(EVIDENCE)
    expect(a.adjudicated_by).toBe('feature-builder')
    expect(a.adjudicated_on).toBe('2026-08-06')
    expect(a.licence).toMatch(/ODbL 1\.0/)
    // The coordinate it replaced, kept ON THE ROW — so "why does this pin disagree with a fresh
    // geocode" is answerable from the row rather than from a config that has since moved on.
    expect(a.superseded).toMatchObject({ precision: 'low' })
    expect(a.superseded.lat).toBeCloseTo(28.7073709, 7)
    // Both distances are RE-DERIVED at run time, never read from the config.
    expect(a.crosscheck_delta_m).toBe(0)
    expect(a.moved_m).toBe(407)
  }, SLOW)

  it('records the adoption in verified_facts_applied and extraction_notes', async () => {
    const doc = await run({ ...baseConfig, ...adoption() }, net([COURTS]))
    const entry = doc.verified_facts_applied.find((f: Row) => f.field === 'coordinate')
    expect(entry).toBeTruthy()
    expect(entry.overrides_workbook).toBe(true)
    expect(entry.from).toContain('low')
    expect(entry.to).toContain('high')
    expect(doc.extraction_notes.some((n: string) => n.includes('coordinate adopted from OSM way/1165951096'))).toBe(true)
  }, SLOW)

  it('cross-checks the reconcile target without constraining it', async () => {
    const matched = { ...baseConfig, ...adoption(), reconciles: [{ candidate_key: 'orl-adventhealth', osm_id: 'way/1165951096' }] }
    expect((await run(matched, net([COURTS]))).venues[0].coordinates.adopted_from)
      .toMatchObject({ reconcile_target_osm_id: 'way/1165951096', matches_reconcile_target: true })

    // A MISMATCH IS RECORDED, NOT FATAL. The courts can legitimately be a different OSM feature from
    // the reconcile target (the Huntsville Town Madison shape), and such a feature often has no
    // facility_listings row, so also_at_site — which requires a listing_id — cannot name it.
    const diverged = { ...baseConfig, ...adoption(), reconciles: [{ candidate_key: 'orl-adventhealth', osm_id: 'way/999' }] }
    expect((await run(diverged, net([COURTS]))).venues[0].coordinates.adopted_from)
      .toMatchObject({ reconcile_target_osm_id: 'way/999', matches_reconcile_target: false })

    // No reconcile at all is neither corroboration nor divergence.
    expect((await run({ ...baseConfig, ...adoption() }, net([COURTS]))).venues[0].coordinates.adopted_from)
      .toMatchObject({ reconcile_target_osm_id: null, matches_reconcile_target: null })
  }, SLOW * 3)   // three full extracts, each paying the real endpoint spacing
})

describe('coordinate adoption — guards, all failing closed', () => {
  it.each(['osm_id', 'expect_lat', 'expect_lng', 'evidence_url', 'reason'])(
    'refuses an entry missing "%s"', async (key) => {
      const cfg = { ...baseConfig, ...adoption() }
      delete (cfg as Row).venue_facts['orl-adventhealth'].coordinate[key]
      await expect(run(cfg, net([COURTS]))).rejects.toThrow(new RegExp(`missing "${key}"`))
    },
  )

  it.each(['adjudicated_by', 'adjudicated_on'])('refuses an entry whose venue_facts spec omits "%s"', async (key) => {
    const cfg = { ...baseConfig, ...adoption({}, { [key]: undefined }) }
    delete (cfg as Row).venue_facts['orl-adventhealth'][key]
    await expect(run(cfg, net([COURTS]))).rejects.toThrow(new RegExp(`requires "${key}"`))
  })

  // THE CROSS-CHECK. The config's stated point is re-derived against what OSM returns today, exactly
  // as workbook_crosscheck is re-derived. A breach means the feature moved or the id is wrong.
  it('refuses when the feature has moved beyond the cross-check tolerance', async () => {
    const cfg = { ...baseConfig, ...adoption({ expect_lat: 28.7500000 }) }
    await expect(run(cfg, net([COURTS]))).rejects.toThrow(/resolves \d+ m from the adjudicated point/)
  }, SLOW)

  it('the cross-check message directs a re-adjudication, never a wider tolerance', async () => {
    const cfg = { ...baseConfig, ...adoption({ expect_lat: 28.7500000 }) }
    await expect(run(cfg, net([COURTS]))).rejects.toThrow(/do NOT widen the tolerance/)
  })

  // THE ANCHOR GUARD — the Koons Park trap. An exact name match 14 km away classifies `high`, so no
  // precision rule can catch it and only distance can.
  it('refuses a feature beyond the anchor guard even when it name-matches perfectly', async () => {
    const cfg = { ...baseConfig, ...adoption({ osm_id: 'way/111', expect_lat: 28.83, expect_lng: -81.2750142 }) }
    await expect(run(cfg, net([FAR_AWAY]))).rejects.toThrow(/sits \d+ m from .* own anchor/)
  })

  // AN ANCHOR IS REQUIRED. Same posture as the township rung refusing to fire with no locus.
  it('refuses to adopt onto a venue that has no coordinate to be guarded against', async () => {
    const stub = net([COURTS], [])   // every search rung comes back empty -> no anchor
    await expect(run({ ...baseConfig, ...adoption() }, stub)).rejects.toThrow(/has NO coordinate for the adopted feature to be guarded against/)
  }, SLOW)

  it('refuses a dangling feature id rather than silently keeping the old pin', async () => {
    await expect(run({ ...baseConfig, ...adoption() }, net([]))).rejects.toThrow(/OSM has no feature way\/1165951096/)
  }, SLOW)

  it('refuses an entry naming a venue the workbook does not contain', async () => {
    const cfg = { ...baseConfig, venue_facts: { 'not-a-venue': { adjudicated_by: 'x', adjudicated_on: '2026-08-06', coordinate: { osm_id: 'way/1', expect_lat: 1, expect_lng: 1, evidence_url: EVIDENCE, reason: 'r' } } } }
    await expect(run(cfg, net([COURTS]))).rejects.toThrow(/stale config/)
  })
})

/**
 * THE STREET-BAND FALLBACK — a SECOND GUARDED PATH, not a wider ADOPT_ANCHOR_MAX_M.
 *
 * The anchor guard asks "is the adopted feature near the pin we already have?" and reads distance as
 * evidence of a different place. That inference needs the existing pin to be approximately right. It
 * is, for AdventHealth — a 407 m error on a parkway beside the courts. It is FALSE BY DEFINITION for a
 * street band, where Nominatim matched the right ROAD NAME and returned the wrong SEGMENT: the guard
 * would then be measuring from the very error the adoption exists to repair. Syracuse's Skyway Park
 * carries four `sport=pickleball` pitches in OSM and sits 2,280 m from its band; Van Buren Central
 * Park the same at 2,532 m.
 *
 * ADOPT_ANCHOR_MAX_M STAYS AT 1000 m — pinned by the last test in this block, which is the one that
 * makes the rest of it safe. Raising it to 2,600 m to admit Skyway would have weakened the Koons Park
 * guard across all 48 metros in exchange for two rows. A band-anchored adoption instead clears two
 * fences the wrong road segment cannot contaminate: the metro envelope, and a locus derived from the
 * venue's postcode (never its street — the street is what produced the band).
 *
 * FIXTURE GEOMETRY IS CONSTRUCTED, not copied off a live venue: each coordinate is placed at a chosen
 * distance by latitude offset (2280 m = 0.020481 deg) so the boundary each test probes is legible from
 * the numbers rather than dependent on what OSM holds today. The envelope is Syracuse's real one.
 */
describe('coordinate adoption — the street-band fallback path', () => {
  const BAND_LAT = 43.1228399
  const BAND_LNG = -76.1386095
  const at = (metresNorth: number) => BAND_LAT + metresNorth / 111320

  /** The real Syracuse row's anchor: a secondary road matched off the ADDRESS rung. */
  const ROAD = {
    licence: LICENCE,
    osm_type: 'way', osm_id: 343907770,
    lat: String(BAND_LAT), lon: String(BAND_LNG),
    category: 'highway', type: 'secondary',
    name: 'East Taft Road',
    namedetails: { name: 'East Taft Road' },
    address: { road: 'East Taft Road', town: 'North Syracuse', postcode: '13212' },
  }

  /** The courts themselves, 2,280 m from the band — unadoptable under the 1000 m anchor guard. */
  const PITCH = {
    licence: LICENCE,
    osm_type: 'way', osm_id: 1200000001,
    lat: String(at(2280)), lon: String(BAND_LNG),
    category: 'leisure', type: 'pitch',
    name: 'Skyway Park Pickleball Courts',
    namedetails: { name: 'Skyway Park Pickleball Courts' },
    address: { road: 'East Taft Road', town: 'North Syracuse', postcode: '13212' },
  }

  /** The 13212 postcode centroid — 926 m from the courts, and independent of East Taft Road. */
  const ZIP_CENTROID = {
    licence: LICENCE,
    osm_type: 'node', osm_id: 900001,
    lat: String(at(1354)), lon: String(BAND_LNG),
    category: 'place', type: 'postcode',
    name: '13212', namedetails: { name: '13212' },
    address: { postcode: '13212' },
  }

  /** Syracuse's real locked envelope. */
  const ENVELOPE = { latMin: 42.72, latMax: 43.83, lngMin: -76.65, lngMax: -75.23 }

  const bandTabs = () => ({
    'Import Ready': [
      ['research_key', 'name', 'city', 'state', 'zip', 'address', 'access_type', 'fee_type', 'research_status', 'website'],
      ['syr-skyway', 'Skyway Park', 'North Syracuse', 'NY', '13212', '5950 E Taft Rd', 'public', 'free', 'probable', 'https://www.northsyracuse.org/'],
    ],
  })

  const bandBase = {
    metro: 'unit-test', batch: 'unit-test', metro_area: 'Syracuse', states: ['NY'],
    envelope: ENVELOPE,
    workbook: { header_row: 1 },
  }

  /**
   * ROUTES BY QUERY SHAPE, so the venue lands on the `address` rung specifically — which is what the
   * street-band signature requires. Every rung carrying the venue NAME returns nothing; the bare
   * address query returns the road. A `street=` query returns nothing, which doubles as proof the
   * fallback never depends on a street locus: it is not merely unused here, it is unavailable.
   */
  function bandNet(lookupPayload: unknown, { zip = [ZIP_CENTROID], city = [] as unknown[] } = {}) {
    const calls = { lookup: 0, search: 0, postcode: 0 }
    const fetchImpl = async (url: URL | string) => {
      const s = String(url)
      const p = new URL(s).searchParams
      let payload: unknown = []
      if (s.includes('/lookup')) { calls.lookup++; payload = lookupPayload }
      else {
        calls.search++
        const q = p.get('q') || ''
        if (p.get('street')) payload = []
        else if (p.get('postalcode') && !q) { calls.postcode++; payload = zip }
        else if (p.get('city') && !q) payload = city
        else if (q && !q.includes('Skyway Park')) payload = [ROAD]
        else payload = []
      }
      return {
        ok: true, status: 200, statusText: 'OK',
        headers: { get: () => null },
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as any
    }
    return { fetchImpl, calls }
  }

  const bandAdoption = (over: Row = {}) => ({
    venue_facts: {
      'syr-skyway': {
        adjudicated_by: 'feature-builder',
        adjudicated_on: '2026-08-07',
        coordinate: {
          osm_id: 'way/1200000001',
          expect_lat: at(2280),
          expect_lng: BAND_LNG,
          evidence_url: 'https://www.openstreetmap.org/way/1200000001',
          reason: 'OSM carries the courts as four sport=pickleball pitches; the address is a range so the ladder can only ever reach the road.',
          ...over,
        },
      },
    },
  })

  const runBand = (config: Row, stub: ReturnType<typeof bandNet>) =>
    extract({ tabs: bandTabs(), config, geocode: true, cachePath: cachePath(), log: () => {}, fetchImpl: stub.fetchImpl })

  /** Seven live-shaped rungs plus a lookup, each paying the real >=1.1 s spacing. */
  const BAND_SLOW = 45_000

  it('adopts a feature 2,280 m from a street band that the anchor guard would refuse', async () => {
    const stub = bandNet([PITCH])
    const doc = await runBand({ ...bandBase, ...bandAdoption() }, stub)
    const c = doc.venues[0].coordinates

    // The superseded pin really was a band off the address rung — the precondition, not an assumption.
    expect(c.adopted_from.superseded.anchor).toMatch(/^highway\//)
    expect(c.adopted_from.superseded.precision).toBe('low')
    expect(c.adopted_from.moved_m).toBe(2280)
    expect(c.lat).toBeCloseTo(at(2280), 7)

    // ...and it passed under the fallback, with the ordinary limit recorded beside it so the artifact
    // says plainly that 2,280 m was NOT waved through the 1000 m guard.
    const g = c.adopted_from.anchor_guard
    expect(g.guard).toBe('street-band-fallback')
    expect(g.ordinary_anchor_limit_m).toBe(1000)
    expect(g.limit_m).toBe(5000)
    expect(g.envelope).toBe('inside')
    expect(g.locus_kind).toBe('zip')
    expect(g.locus_distance_m).toBe(926)
    expect(c.adopted_from.superseded_was_street_band).toContain('STREET-BAND ANCHOR')
  }, BAND_SLOW)

  // THE LOCUS IS FREE IN PRACTICE. The township rung already asks `{postalcode, country}` and the
  // cache is keyed on the params alone, so the fallback's zip query is a HIT on a venue that reached
  // the township rung — which every band-anchored venue does, since a band is never `high`.
  it('costs no extra live request for the locus when the township rung already resolved the zip', async () => {
    const stub = bandNet([PITCH])
    await runBand({ ...bandBase, ...bandAdoption() }, stub)
    expect(stub.calls.postcode).toBe(1)
    expect(stub.calls.lookup).toBe(1)
  }, BAND_SLOW)

  it('refuses a feature outside the metro envelope, before it ever asks for a locus', async () => {
    const far = { ...PITCH, lat: '44.2000000' }
    const cfg = { ...bandBase, ...bandAdoption({ expect_lat: 44.2 }) }
    await expect(runBand(cfg, bandNet([far]))).rejects.toThrow(/OUTSIDE the Syracuse envelope/)
  }, BAND_SLOW)

  it('refuses a feature beyond the locus limit even though it is inside the envelope', async () => {
    // 6,000 m north of the zip centroid, still comfortably inside Syracuse's box.
    const lat = at(1354) + 6000 / 111320
    const drifted = { ...PITCH, lat: String(lat) }
    const cfg = { ...bandBase, ...bandAdoption({ expect_lat: lat }) }
    await expect(runBand(cfg, bandNet([drifted]))).rejects.toThrow(/sits 6000 m from syr-skyway's zip locus — limit 5000 m/)
  }, BAND_SLOW)

  it('refuses when NO road-independent locus resolves, rather than fencing on the envelope alone', async () => {
    const stub = bandNet([PITCH], { zip: [], city: [] })
    await expect(runBand({ ...bandBase, ...bandAdoption() }, stub))
      .rejects.toThrow(/NO ROAD-INDEPENDENT LOCUS could be resolved/)
  }, BAND_SLOW)

  it('refuses when the config carries no envelope to fall back to', async () => {
    const { envelope, ...noEnvelope } = bandBase
    await expect(runBand({ ...noEnvelope, ...bandAdoption() }, bandNet([PITCH])))
      .rejects.toThrow(/this config has none/)
  }, BAND_SLOW)

  // THE TEST THAT KEEPS THE REST OF THIS BLOCK HONEST. Same 2,280 m, same everything — except the
  // superseded anchor is a BOUNDARY CENTROID rather than a road, so it is not a band and the ordinary
  // guard applies unchanged. If this ever passes, ADOPT_ANCHOR_MAX_M has been loosened by the back
  // door and the Koons Park trap is open in every metro.
  it('still refuses 2,280 m when the superseded anchor is NOT a road — the constant is untouched', async () => {
    const boundary = {
      ...ROAD,
      category: 'boundary', type: 'administrative',
      name: 'North Syracuse', namedetails: { name: 'North Syracuse' },
    }
    const stub = bandNet([PITCH])
    const inner = stub.fetchImpl
    // Same routing, but the address rung yields a boundary centroid instead of a road.
    const fetchImpl = async (url: URL | string) => {
      const s = String(url)
      const p = new URL(s).searchParams
      const q = p.get('q') || ''
      if (!s.includes('/lookup') && q && !q.includes('Skyway Park') && !p.get('street')) {
        return {
          ok: true, status: 200, statusText: 'OK',
          headers: { get: () => null },
          json: async () => [boundary],
          text: async () => JSON.stringify([boundary]),
        } as any
      }
      return inner(url)
    }
    await expect(runBand({ ...bandBase, ...bandAdoption() }, { ...stub, fetchImpl }))
      .rejects.toThrow(/sits 2280 m from syr-skyway's own anchor .* limit 1000 m/)
  }, BAND_SLOW)
})

describe('coordinate adoption — no-op by construction', () => {
  it('changes nothing for a config with no coordinate entry', async () => {
    const stub = net([COURTS])
    const doc = await run(baseConfig, stub)
    expect(stub.calls.lookup).toBe(0)
    expect(doc.venues[0].coordinates.precision).toBe('low')
    expect(doc.venues[0].coordinates.adopted_from).toBeUndefined()
    expect(doc.verified_facts_applied).toEqual([])
  }, SLOW)

  // A --no-geocode shape check must not resolve features or change a coordinate; it is the pass that
  // costs nothing and is run first on every new metro.
  it('resolves nothing under --no-geocode', async () => {
    const stub = net([COURTS])
    const doc = await extract({ tabs: tabs(), config: { ...baseConfig, ...adoption() }, geocode: false, cachePath: cachePath(), log: () => {}, fetchImpl: stub.fetchImpl })
    expect(stub.calls.lookup).toBe(0)
    expect(stub.calls.search).toBe(0)
    expect(doc.venues[0].coordinates ?? null).toBeNull()
  }, SLOW)
})
