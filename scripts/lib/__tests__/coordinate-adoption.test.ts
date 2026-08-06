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
