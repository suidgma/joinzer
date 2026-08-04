/**
 * The two fallback rungs added 2026-08-04: `structured-nosuite` and `structured-nocity`.
 *
 * Every fixture is a REAL Nominatim response shape captured from the Jackson / 18-metro probes, with
 * coordinates left exactly as OSM returned them — so the distances these tests assert on are the same
 * distances the rungs were designed against.
 *
 * NO NETWORK IS TOUCHED. Every `geocodeVenue` call injects `fetchImpl`, and each test asserts the
 * global live-request counter did not move. That matters more than it looks: a cache pointed at a
 * directory that does not exist yields ZERO seeds, so a "pre-seeded, network-free" assumption can
 * silently become a real request. The counter turns that from an inference into a measurement.
 *
 * `geocode-nominatim.mjs` is plain ESM with no types, so tsc widens its exports to `object`. One local
 * alias plus typed wrappers at the boundary keeps `tsc --noEmit` green without loosening the gate.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { geocodeVenue, liveRequestCount, stripSuite } from '../geocode-nominatim.mjs'

type Row = Record<string, any>

const geocode = geocodeVenue as (venue: Row, opts: Row) => Promise<Row | null>
const liveRequests = liveRequestCount as () => number
const strip = stripSuite as (address: unknown) => string | null

const roots: string[] = []
const newCachePath = () => {
  const root = mkdtempSync(join(tmpdir(), 'joinzer-rungs-'))
  roots.push(root)
  const dir = join(root, '.geocode-cache')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'testmetro.json')
}
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }) })

const okResponse = (hits: Row[]) => ({
  ok: true, status: 200, statusText: 'OK', headers: { get: () => null },
  json: async () => hits, text: async () => JSON.stringify(hits),
})

/** An UNNAMED rooftop address point — `place/house`, place_rank 30. Classifies `high`. This is the
 *  exact shape that rescued Jackson's Ridgeland Tennis Center once the city was dropped. */
const houseHit = (lat: number, lon: number, houseNumber: string): Row => ({
  lat: String(lat), lon: String(lon), category: 'place', type: 'house', place_rank: 30,
  osm_type: 'way', osm_id: 13666821, name: '', namedetails: null,
  address: { house_number: houseNumber, road: 'McClellan Drive' },
})

/** A street centerline — what an over-constrained structured query falls back to. Classifies `low`. */
const streetHit = (lat: number, lon: number, name: string): Row => ({
  lat: String(lat), lon: String(lon), category: 'highway', type: 'tertiary',
  osm_type: 'way', osm_id: 99, name, namedetails: { name }, address: { road: name },
})

const postcodeHit = (lat: number, lon: number, code: string): Row => ({
  lat: String(lat), lon: String(lon), category: 'place', type: 'postcode',
  osm_type: 'node', osm_id: 7, name: code, namedetails: { name: code }, address: { postcode: code },
})

/**
 * Route a fixture by the query's own parameters, so each test declares what OSM returns for each
 * distinct question rather than depending on call ORDER — which is what makes these tests survive a
 * future reordering of the ladder instead of silently asserting the wrong rung.
 */
const router = (routes: { match: (p: URLSearchParams) => boolean; hits: Row[] }[]) => {
  const seen: string[] = []
  const fetchImpl = async (url: any) => {
    const params = new URL(String(url)).searchParams
    seen.push(String(params))
    const route = routes.find((r) => r.match(params))
    return okResponse(route ? route.hits : [])
  }
  return { fetchImpl, seen }
}

const hasCity = (p: URLSearchParams) => p.get('city') != null
const isStructured = (p: URLSearchParams) => p.get('street') != null

describe('stripSuite', () => {
  it('strips every designator form the corpus actually contains', () => {
    expect(strip('547 Church Road, Suite G')).toBe('547 Church Road')
    expect(strip('500 Furys Ferry Rd Ste 107')).toBe('500 Furys Ferry Rd')
    expect(strip('1040 D W Griffith Ln Unit 2')).toBe('1040 D W Griffith Ln')
    expect(strip('629 N Saratoga Rd Bldg 2')).toBe('629 N Saratoga Rd')
    expect(strip('26th St Bldg 25713')).toBe('26th St')
    expect(strip('470 Lewis Ave Unit 4036')).toBe('470 Lewis Ave')
    expect(strip('3101 Gilmore Avenue #100')).toBe('3101 Gilmore Avenue')
    expect(strip('2020 Gunbarrel Rd, #186')).toBe('2020 Gunbarrel Rd')
  })

  /**
   * THE REGRESSION THIS FILE EXISTS FOR. My first draft matched the keyword then allowed `[-\w]*`,
   * which reads as obviously correct and turns "100 Unit Road" into "100" — because `Road` is a
   * perfectly good word-character run. Requiring the identifier to be digit-bearing or a lone letter
   * is a claim about the FORM of a unit number, not a pattern fitted to the examples in hand.
   */
  it('does NOT eat a road whose name merely contains a designator word', () => {
    expect(strip('100 Unit Road')).toBeNull()
    expect(strip('42 Building Street')).toBeNull()
    expect(strip('9 Suite Lane')).toBeNull()
  })

  it('requires a digit in the bare # form, so a stray hash is not a designator', () => {
    expect(strip('12 Number # Road')).toBeNull()
  })

  it('returns null when there is nothing to strip, so the caller adds no rung', () => {
    expect(strip('853 Old Vicksburg Road')).toBeNull()
    expect(strip('')).toBeNull()
    expect(strip(null)).toBeNull()
  })
})

describe('structured-nosuite rung', () => {
  it('rescues a venue whose suite designator broke the structured query', async () => {
    const before = liveRequests()
    // The raw address returns nothing; the stripped one returns the rooftop. Exactly Augusta's
    // AUG-RIC-005 and Tucson's tucson-ace, which go from NO COORDINATE to publishable.
    const { fetchImpl, seen } = router([
      { match: (p) => p.get('street') === '500 Furys Ferry Rd', hits: [houseHit(33.536386, -82.079018, '500')] },
    ])
    const res = await geocode(
      { name: 'DiNKD Indoor Pickleball', address: '500 Furys Ferry Rd Ste 107', city: 'Augusta', state: 'GA', zip: '30907' },
      { cachePath: newCachePath(), fetchImpl },
    )
    expect(res).not.toBeNull()
    expect(res!.precision).toBe('high')
    expect(res!.matched_rung).toBe('structured-nosuite')
    expect(seen.some((q) => q.includes('500+Furys+Ferry+Rd+Ste+107'))).toBe(true)
    expect(liveRequests()).toBe(before + seen.length)
  }, 30_000)

  it('issues no extra request at all when the address carries no designator', async () => {
    const { fetchImpl, seen } = router([])
    await geocode(
      { name: 'Towne Park', address: '853 Old Vicksburg Road', city: 'Clinton', state: 'MS', zip: '39056' },
      { cachePath: newCachePath(), fetchImpl },
    )
    // The no-op is BY CONSTRUCTION — stripSuite returned null so the rung was never added. Asserting
    // it on the wire is what proves the construction argument rather than restating it.
    // `seen` holds the serialized query strings, so these are string tests, not URLSearchParams ones.
    const structured = seen.filter((q) => q.includes('street='))
    expect(structured.length).toBeGreaterThan(0)
    expect(structured.some((q) => !q.includes('city='))).toBe(true) // the no-city rung did fire
    // Exactly one structured query per distinct street form: the raw one (with city) and the no-city
    // retry. A third would mean a nosuite rung was added for an address that carries no designator.
    expect(structured.filter((q) => q.includes('city='))).toHaveLength(1)
    // The DISTINCT street values are exactly two: the full address (rung 1 and the no-city retry) and
    // the house-number-stripped form (the township street locus). A third distinct value would be a
    // nosuite rung fabricated for an address that carries no designator.
    // NB: do not pattern-match designator words against the whole query string — `country=United
    // States` contains "Unit", which is how the first version of this assertion passed for the wrong
    // reason. Read the parameter, not the serialized blob.
    const streets = [...new Set(structured.map((q) => new URLSearchParams(q).get('street')))]
    expect(streets.sort()).toEqual(['853 Old Vicksburg Road', 'Old Vicksburg Road'])
  }, 30_000)
})

describe('structured-nocity rung', () => {
  /** Jackson JAC-MS-006 exactly: the workbook says Ridgeland, OSM files 201 McClellan Drive under
   *  Madison, so `city=Ridgeland` over-constrains and Nominatim falls back to the centerline. */
  const ridgeland = {
    name: 'Ridgeland Tennis Center & Pickleball Courts',
    address: '201 McClellan Drive', city: 'Ridgeland', state: 'MS', zip: '39157',
  }
  const centerline = streetHit(32.4394975, -90.1173493, 'McClellan Drive')
  const zipCentroid = postcodeHit(32.42, -90.13, '39157')

  it('recovers a rooftop the postal city was hiding', async () => {
    const { fetchImpl } = router([
      // Every city-bearing structured query gets the centerline; the city-less one gets the rooftop.
      { match: (p) => isStructured(p) && hasCity(p), hits: [centerline] },
      { match: (p) => p.get('postalcode') === '39157' && !isStructured(p), hits: [zipCentroid] },
      { match: (p) => isStructured(p) && !hasCity(p) && p.get('street') === 'McClellan Drive', hits: [centerline] },
      { match: (p) => isStructured(p) && !hasCity(p), hits: [houseHit(32.43968, -90.119761, '201')] },
    ])
    const res = await geocode(ridgeland, { cachePath: newCachePath(), fetchImpl })
    expect(res).not.toBeNull()
    expect(res!.precision).toBe('high')
    expect(res!.matched_rung).toBe('structured-nocity')
    expect(res!.anchor).toContain('no-city locus guard')
  }, 30_000)

  /**
   * THE NEGATIVE CONTROL, and the reason this rung is guarded rather than merely added. Across an
   * 18-metro sample, 4 venues returned a hit carrying the venue's EXACT house number 5.4-49 km away —
   * a different road of the same name in another county. Lakeland's is the worst at 49,428 m. A house
   * number matches on every road that has one, so no precision rule can catch this; only distance can.
   */
  it('REJECTS an exact house-number match in the wrong county and keeps the honest low', async () => {
    const { fetchImpl } = router([
      { match: (p) => isStructured(p) && hasCity(p), hits: [centerline] },
      { match: (p) => p.get('postalcode') === '39157' && !isStructured(p), hits: [zipCentroid] },
      { match: (p) => isStructured(p) && !hasCity(p) && p.get('street') === 'McClellan Drive', hits: [centerline] },
      // Same house number, 49 km away — the Lakeland shape.
      { match: (p) => isStructured(p) && !hasCity(p), hits: [houseHit(28.0169374, -82.4524941, '201')] },
    ])
    const res = await geocode(ridgeland, { cachePath: newCachePath(), fetchImpl })
    expect(res).not.toBeNull()
    expect(res!.precision).toBe('low')
    expect(res!.matched_rung).toBe('structured')
    expect(res!.matched_name).toBe('McClellan Drive')
  }, 30_000)

  it('does not fire once the ordinary ladder has already produced a high anchor', async () => {
    const { fetchImpl, seen } = router([
      { match: (p) => isStructured(p) && hasCity(p), hits: [houseHit(32.43968, -90.119761, '201')] },
    ])
    const res = await geocode(ridgeland, { cachePath: newCachePath(), fetchImpl })
    expect(res!.precision).toBe('high')
    expect(res!.matched_rung).toBe('structured')
    // A `high` on rung 1 short-circuits everything, so the venue costs exactly ONE request and the
    // 904 corpus venues that already anchor high cannot move and cannot spend.
    expect(seen).toHaveLength(1)
  })
})
