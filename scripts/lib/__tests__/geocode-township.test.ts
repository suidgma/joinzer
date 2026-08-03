/**
 * Township-rung distance guard.
 *
 * Every fixture below is a REAL Nominatim response shape captured from the Harrisburg probe, with the
 * coordinates left exactly as OSM returned them — so the numbers these tests assert on are the same
 * numbers the threshold was derived from. No network is touched.
 *
 * `geocode-nominatim.mjs` is plain ESM with no types, so tsc widens its exports to `object`. One local
 * alias plus typed wrappers at the boundary keeps `tsc --noEmit` green without loosening the gate.
 */
import { describe, expect, it } from 'vitest'
import {
  TOWNSHIP_LOCUS_MAX_M,
  TOWNSHIP_NAME_MAX_M,
  guardTownshipHits,
  metresBetween,
  resolveTownshipLocus,
  streetWithoutHouseNumber,
} from '../geocode-nominatim.mjs'

type Row = Record<string, any>

// geocode-nominatim.mjs is untyped ESM, so tsc infers its parameter types from the JS default values
// (`streetHits = []` widens to `never[]`). Cast at the boundary rather than excluding the file or
// loosening the gate — one alias, and the call sites below stay fully checked against it.
type Locus = { kind: string; lat: number; lng: number; from_zip_m: number | null; hit: Row; discarded_street: Row | null }

const resolveLocus = resolveTownshipLocus as (a: Row) => Locus | null
const guardHits = guardTownshipHits as (hits: Row[], locus: Row, maxM?: number) =>
  { accepted: { hit: Row; distance_m: number }[]; rejected: { hit: Row; distance_m: number | null; reason: string }[] }
const distance = metresBetween as (aLat: number, aLng: number, bLat: number, bLng: number) => number

const locusOf = (a: { streetHits?: Row[]; zipHits?: Row[]; locusMaxM?: number }) => resolveLocus(a)
const guard = (hits: Row[], locus: Row, maxM?: number) => guardHits(hits, locus, maxM)

const hit = (name: string, lat: number, lon: number, extra: Row = {}): Row => ({
  lat: String(lat), lon: String(lon), class: 'leisure', type: 'park',
  osm_type: 'way', osm_id: 1, name, namedetails: { name }, address: {}, ...extra,
})

// --- real Harrisburg fixtures -------------------------------------------------------------------
const ZIP_17112 = hit('17112', 40.338257, -76.778285, { class: 'place', type: 'postcode' })
const ZIP_17050 = hit('17050', 40.248815, -77.001069, { class: 'place', type: 'postcode' })
const ZIP_17055 = hit('17055', 40.189562, -76.992059, { class: 'place', type: 'postcode' })

const LARUE_ST = hit('Larue Street', 40.341040, -76.795377, { class: 'highway', type: 'residential' })
const KOONS_HERSHEY = hit('Koons Park', 40.2486267, -76.665587)

const CAROLYN_ST_HITS = [
  hit('Carolyn Street', 40.313893, -76.799096, { class: 'highway', type: 'residential' }),
  hit('Carolyn Street', 40.313782, -76.802513, { class: 'highway', type: 'residential' }),
  hit('Carolyn Street', 40.313858, -76.808397, { class: 'highway', type: 'residential' }),
]
const BRIGHTBILL = hit('Brightbill Park', 40.311756, -76.8084581)

// "Creekview Rd, PA 17050" resolves to a DIFFERENT Creekview Road 37 km away in Lower Mifflin Township
const CREEKVIEW_RD_WRONG = [
  hit('Creekview Road', 40.190932, -77.434677, { class: 'highway', type: 'residential' }),
  hit('Creekview Road', 41.137320, -76.912505, { class: 'highway', type: 'service' }),
]
const CREEKVIEW_PARK = hit('Creekview Park', 40.2687507, -76.9776121)

// "Hampden Park, PA" returns Berks County FIRST and the correct Hampden Township park SECOND
const HAMPDEN_HITS = [
  hit('Hampden Park', 40.3513959, -75.9097995),
  hit('Hampden Park', 40.2364362, -76.9768338),
]

describe('streetWithoutHouseNumber', () => {
  it('strips a leading house number, keeping the street', () => {
    expect(streetWithoutHouseNumber('126 Carolyn St')).toBe('Carolyn St')
    expect(streetWithoutHouseNumber('4064 Lisburn Rd')).toBe('Lisburn Rd')
    expect(streetWithoutHouseNumber('11210A Bass Pro Pkwy')).toBe('Bass Pro Pkwy')
  })
  it('returns null rather than an empty string when nothing is left', () => {
    expect(streetWithoutHouseNumber(null)).toBeNull()
    expect(streetWithoutHouseNumber('   ')).toBeNull()
    expect(streetWithoutHouseNumber('126')).toBeNull()
  })
  it('leaves an address with no house number alone', () => {
    expect(streetWithoutHouseNumber('Center Rd')).toBe('Center Rd')
  })
})

describe('resolveTownshipLocus', () => {
  it('prefers a street locus and picks the hit NEAREST the zip centroid, not hit[0]', () => {
    const l = locusOf({ streetHits: CAROLYN_ST_HITS, zipHits: [ZIP_17112] })
    expect(l?.kind).toBe('street')
    // hit[0] is nearest to the 17112 centroid (3,237 m) — assert the measurement, not the index
    expect(l?.from_zip_m).toBe(3237)
    expect(l?.lat).toBeCloseTo(40.313893, 6)
  })

  it('DISCARDS a street locus that sits implausibly far from the zip centroid, and falls back to the zip', () => {
    const l = locusOf({ streetHits: CREEKVIEW_RD_WRONG, zipHits: [ZIP_17050] })
    expect(l?.kind).toBe('zip')
    expect(l?.discarded_street?.from_zip_m).toBe(37432)
    expect(l?.lat).toBeCloseTo(40.248815, 6)
  })

  it('falls back to the zip centroid when the street resolves to nothing at all (Hampden Park Dr)', () => {
    const l = locusOf({ streetHits: [], zipHits: [ZIP_17050] })
    expect(l?.kind).toBe('zip')
    expect(l?.discarded_street).toBeNull()
  })

  it('takes an UNVALIDATED street locus when the venue has no zip, and marks it so', () => {
    const l = locusOf({ streetHits: CAROLYN_ST_HITS, zipHits: [] })
    expect(l?.kind).toBe('street')
    expect(l?.from_zip_m).toBeNull()
  })

  it('returns null when neither the street nor the postcode resolved — the rung must not fire', () => {
    expect(locusOf({ streetHits: [], zipHits: [] })).toBeNull()
    expect(locusOf({})).toBeNull()
  })

  it('ignores hits carrying no usable coordinate', () => {
    expect(locusOf({ streetHits: [{ lat: 'x', lon: 'y' }], zipHits: [] })).toBeNull()
  })

  it('honours a caller-supplied locusMaxM', () => {
    // the same Carolyn Street locus is 3,237 m out — admitted at 10 km, discarded at 1 km
    expect(locusOf({ streetHits: CAROLYN_ST_HITS, zipHits: [ZIP_17112], locusMaxM: 1000 })?.kind).toBe('zip')
    expect(locusOf({ streetHits: CAROLYN_ST_HITS, zipHits: [ZIP_17112], locusMaxM: 10000 })?.kind).toBe('street')
  })
})

describe('guardTownshipHits — the Koons Park trap', () => {
  it('REJECTS the Hershey "Koons Park" against the Larue Street locus', () => {
    const locus = locusOf({ streetHits: [LARUE_ST], zipHits: [ZIP_17112] })!
    expect(locus.kind).toBe('street')
    const { accepted, rejected } = guard([KOONS_HERSHEY], locus)
    expect(accepted).toHaveLength(0)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].distance_m).toBe(15081)
    expect(rejected[0].reason).toContain('guard 5000 m')
  })

  it('rejects it against the zip locus too, so the fallback path is not a way in', () => {
    const locus = locusOf({ streetHits: [], zipHits: [ZIP_17112] })!
    const { accepted, rejected } = guard([KOONS_HERSHEY], locus)
    expect(accepted).toHaveLength(0)
    expect(rejected[0].distance_m).toBe(13829)
  })
})

describe('guardTownshipHits — selection, not just veto', () => {
  it('drops Nominatim hit[0] and keeps the correct hit[1] (Hampden Park)', () => {
    const locus = locusOf({ streetHits: [], zipHits: [ZIP_17050] })!
    const { accepted, rejected } = guard(HAMPDEN_HITS, locus)
    expect(accepted).toHaveLength(1)
    expect(accepted[0].hit.lat).toBe('40.2364362')
    expect(accepted[0].distance_m).toBe(2478)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].distance_m).toBeGreaterThan(90000)
  })

  it('accepts the legitimate road-centerline cases the threshold exists to admit', () => {
    const brightbill = locusOf({ streetHits: CAROLYN_ST_HITS, zipHits: [ZIP_17112] })!
    expect(guard([BRIGHTBILL], brightbill).accepted[0].distance_m).toBe(830)

    const creekview = locusOf({ streetHits: CREEKVIEW_RD_WRONG, zipHits: [ZIP_17050] })!
    expect(guard([CREEKVIEW_PARK], creekview).accepted[0].distance_m).toBe(2982)
  })

  it('rejects a hit with no usable coordinate instead of throwing', () => {
    const locus = locusOf({ streetHits: [], zipHits: [ZIP_17055] })!
    const { accepted, rejected } = guard([{ lat: null, lon: null }], locus)
    expect(accepted).toHaveLength(0)
    expect(rejected[0].distance_m).toBeNull()
  })

  it('treats the threshold as inclusive at the boundary', () => {
    const locus = locusOf({ streetHits: [], zipHits: [ZIP_17055] })!
    // a point placed exactly TOWNSHIP_NAME_MAX_M north of the locus
    const exact = hit('Edge Park', locus.lat + TOWNSHIP_NAME_MAX_M / 111320, locus.lng)
    expect(guard([exact], locus).accepted).toHaveLength(1)
    const past = hit('Past Park', locus.lat + (TOWNSHIP_NAME_MAX_M + 200) / 111320, locus.lng)
    expect(guard([past], locus).accepted).toHaveLength(0)
  })
})

describe('the constants are the ones the evidence supports', () => {
  /**
   * The margin is asserted against the CORPUS MAXIMUM, not the design sample. The original figure
   * (Harrisburg's Lower Allen Community Park, 3,226 m -> 1.55x) stopped reproducing once all 30
   * configs ran: Pepper Beachside Park was accepted at 4,543 m, so the real headroom is 1.10x. A
   * constant defended by a number that no longer reproduces is one nobody trusts enough to revisit.
   */
  it('admits the worst legitimate offset IN THE WHOLE CORPUS and rejects the trap', () => {
    const designSample = 3226 // Lower Allen Community Park -> Lisburn Rd centerline (Harrisburg)
    const corpusMax = 4543 // Pepper Beachside Park -> N State Road A1A locus (port-st-lucie) — binding
    const trap = 15081 // Koons Park (Hershey) -> Larue Street
    expect(corpusMax).toBeGreaterThan(designSample) // the binding case is NOT the one it was designed on
    expect(TOWNSHIP_NAME_MAX_M).toBeGreaterThan(corpusMax)
    expect(TOWNSHIP_NAME_MAX_M).toBeLessThan(trap)
    // real headroom above the widest legitimate acceptance: 1.10x
    expect(TOWNSHIP_NAME_MAX_M / corpusMax).toBeGreaterThan(1.1)
    expect(TOWNSHIP_NAME_MAX_M / corpusMax).toBeLessThan(1.15)
    // threshold to trap: 3.02x — and the separation between the two OBSERVED sets: 3.32x
    expect(trap / TOWNSHIP_NAME_MAX_M).toBeGreaterThan(3)
    expect(trap / corpusMax).toBeGreaterThan(3.3)
  })

  it('admits every legitimate street locus and rejects the wrong Creekview Road', () => {
    expect(TOWNSHIP_LOCUS_MAX_M).toBeGreaterThan(6762) // Bishop Park, the widest legitimate one
    expect(TOWNSHIP_LOCUS_MAX_M).toBeLessThan(37432) // the wrong Creekview Road
  })

  it('metresBetween reproduces the distances these thresholds were derived from', () => {
    expect(Math.round(distance(40.2486267, -76.665587, 40.341040, -76.795377))).toBe(15081)
    expect(Math.round(distance(40.2687507, -76.9776121, 40.248815, -77.001069))).toBe(2982)
  })
})
