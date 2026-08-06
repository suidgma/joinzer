/**
 * THE RECONCILE COORDINATE GUARD — `assertReconcileCoordinate`.
 *
 * A reconcile silently overwrote the target's coordinate, two ways. `listingFields` sends
 * `lat: v.coordinates?.lat ?? null` and `mergeOntoTarget` restores only PRESERVE_ON_RECONCILE, from
 * which lat/lng are deliberately absent — so the incoming value always won. Reconciling an
 * un-geocoded row wrote NULL over a good coordinate; reconciling a worse-geocoded row wrote a street
 * band over a court-accurate pin. Both were caught by a human reading source, never by the pipeline.
 *
 * The guard was blind by construction as well as by logic: RECONCILE_TARGET_COLUMNS did not fetch
 * lat/lng at all, so preflight could not have seen the coordinate it was about to destroy. The first
 * test here pins that, because it is the kind of omission that silently comes back.
 *
 * THE SPLIT IS THE DESIGN. 'destroys' is fatal with no acknowledgement, because no legitimate case
 * exists. 'degrades' takes an acknowledgement, because one demonstrably does — Orlando's owner
 * accepted exactly that trade on a target that published nothing.
 */
import { describe, expect, it } from 'vitest'
import { assertReconcileCoordinate, RECONCILE_TARGET_COLUMNS, PRESERVE_ON_RECONCILE } from '../reconcile-merge.mjs'

type Row = Record<string, any>
const check = (a: Row) => assertReconcileCoordinate(a as any) as {
  verdict: string; distance_m: number | null; incoming_precision: string | null
  fatal: string | null; trade: Row | null; report: string
}

const REC = { candidate_key: 'orl-adventhealth', osm_id: 'way/1165951096', listing_id: '598e3a09' }

/** The live AdventHealth numbers: the street band the ladder produced, and the OSM courts centroid
 *  the dormant target carried. 415 m apart per the LIVE ROW, recomputed by the guard rather than quoted. */
const STREET_PIN = { lat: 28.7073709, lng: -81.2708528 }
const OSM_COURTS = { lat: 28.7078188, lng: -81.2750719 }

const incoming = (lat: number | null, lng: number | null, precision: string | null): Row => ({
  lat, lng,
  provenance: precision ? { coordinate: { precision } } : {},
})
const target = (lat: number | null, lng: number | null): Row => ({ id: REC.listing_id, lat, lng })

const goodTrade = (over: Row = {}) => ({
  acknowledged: true,
  incoming_precision: 'low',
  distance_m: 415,
  reason: 'The target has metro_area NULL and publishes nothing today, so protecting its precision would keep a 14-court flagship dark to guard a pin nobody can see.',
  adjudicated_by: 'owner',
  adjudicated_on: '2026-08-06',
  ...over,
})

describe('the SELECT that made the guard blind', () => {
  // A column that is not fetched reads as `undefined`, which is indistinguishable from "the target
  // holds nothing" — so before this the guard could not have fired even if it had existed.
  it('fetches lat and lng from the reconcile target', () => {
    expect(RECONCILE_TARGET_COLUMNS).toContain('lat')
    expect(RECONCILE_TARGET_COLUMNS).toContain('lng')
  })

  // The fix is to SEE the trade, never to preserve the coordinate: preserving lat/lng would make
  // provenance.coordinate describe a coordinate the row does not hold, and the pair is coupled.
  it('does NOT add lat/lng to PRESERVE_ON_RECONCILE', () => {
    expect(PRESERVE_ON_RECONCILE).not.toContain('lat')
    expect(PRESERVE_ON_RECONCILE).not.toContain('lng')
  })
})

describe('destroys — NULL over a good coordinate', () => {
  it('is fatal when the research row has no coordinate and the target has one', () => {
    const r = check({ incoming: incoming(null, null, null), target: target(OSM_COURTS.lat, OSM_COURTS.lng), rec: REC })
    expect(r.verdict).toBe('destroys')
    expect(r.fatal).toMatch(/WOULD|write NULL over it/)
  })

  // NO ACKNOWLEDGEMENT EXISTS FOR THIS, and that is deliberate: it deletes a coordinate AND leaves a
  // row the gate blocks, so it is strictly worse on both axes. An override here would be the bypass
  // this whole slice exists to avoid building.
  it('stays fatal even when a coordinate_trade is supplied', () => {
    const r = check({
      incoming: incoming(null, null, null),
      target: target(OSM_COURTS.lat, OSM_COURTS.lng),
      rec: { ...REC, coordinate_trade: goodTrade({ incoming_precision: null, distance_m: null }) },
    })
    expect(r.verdict).toBe('destroys')
    expect(r.fatal).toBeTruthy()
  })

  it('names the three legitimate ways out, including adoption', () => {
    const r = check({ incoming: incoming(null, null, null), target: target(OSM_COURTS.lat, OSM_COURTS.lng), rec: REC })
    expect(r.fatal).toContain('venue_facts')
    expect(r.fatal).toContain('never reconcile a row that failed to geocode'.replace('never', 'Never'))
  })

  it('is NOT triggered when the target holds no coordinate either', () => {
    const r = check({ incoming: incoming(null, null, null), target: target(null, null), rec: REC })
    expect(r.verdict).toBe('ok')
    expect(r.fatal).toBeNull()
  })
})

describe('degrades — a low-precision pin over a named OSM feature', () => {
  it('is fatal without an acknowledgement, and re-derives the distance itself', () => {
    const r = check({ incoming: incoming(STREET_PIN.lat, STREET_PIN.lng, 'low'), target: target(OSM_COURTS.lat, OSM_COURTS.lng), rec: REC })
    expect(r.verdict).toBe('degrades')
    expect(r.fatal).toBeTruthy()
    // The real Orlando separation, recomputed rather than quoted.
    expect(r.distance_m).toBe(415)
  })

  it('offers adoption first and the acknowledgement second', () => {
    const r = check({ incoming: incoming(STREET_PIN.lat, STREET_PIN.lng, 'low'), target: target(OSM_COURTS.lat, OSM_COURTS.lng), rec: REC })
    expect(r.fatal).toContain('venue_facts.orl-adventhealth.coordinate')
    expect(r.fatal).toContain('"acknowledged": true')
    // The paste-ready block carries the re-derived number, so an operator cannot accidentally
    // acknowledge a distance that was never true.
    expect(r.fatal).toContain('"distance_m": 415')
  })

  it('passes with a matching acknowledgement and records the trade', () => {
    const r = check({
      incoming: incoming(STREET_PIN.lat, STREET_PIN.lng, 'low'),
      target: target(OSM_COURTS.lat, OSM_COURTS.lng),
      rec: { ...REC, coordinate_trade: goodTrade() },
      nowIso: '2026-08-06T00:00:00.000Z',
    })
    expect(r.fatal).toBeNull()
    expect(r.trade).toMatchObject({
      distance_m: 415,
      incoming_precision: 'low',
      adjudicated_by: 'owner',
      recoverable_from: 'provenance.osm_reconcile.osm_original',
    })
    // The coordinate it replaced is recorded next to the pointer that makes it recoverable.
    expect(r.trade!.superseded).toMatchObject({ lat: OSM_COURTS.lat, lng: OSM_COURTS.lng })
  })

  // THE PROPERTY THAT STOPS THIS BEING A BYPASS FLAG: the acknowledgement is re-derived on every
  // run, so one that was true when written stops being accepted the moment the data moves.
  it('rejects a STALE acknowledgement whose distance no longer recomputes', () => {
    const r = check({
      incoming: incoming(STREET_PIN.lat, STREET_PIN.lng, 'low'),
      target: target(OSM_COURTS.lat, OSM_COURTS.lng),
      rec: { ...REC, coordinate_trade: goodTrade({ distance_m: 12 }) },
    })
    expect(r.fatal).toMatch(/recomputes to 415/)
  })

  it('rejects an acknowledgement whose precision no longer matches the row', () => {
    const r = check({
      incoming: incoming(STREET_PIN.lat, STREET_PIN.lng, 'low'),
      target: target(OSM_COURTS.lat, OSM_COURTS.lng),
      rec: { ...REC, coordinate_trade: goodTrade({ incoming_precision: 'medium' }) },
    })
    expect(r.fatal).toMatch(/no longer describes this data/)
  })

  it('rejects `acknowledged` that is anything other than true', () => {
    for (const v of [false, 'yes', 1, null]) {
      const r = check({
        incoming: incoming(STREET_PIN.lat, STREET_PIN.lng, 'low'),
        target: target(OSM_COURTS.lat, OSM_COURTS.lng),
        rec: { ...REC, coordinate_trade: goodTrade({ acknowledged: v }) },
      })
      expect(r.fatal).toBeTruthy()
    }
  })

  it.each(['reason', 'adjudicated_by', 'adjudicated_on'])('rejects an acknowledgement missing "%s"', (k) => {
    const r = check({
      incoming: incoming(STREET_PIN.lat, STREET_PIN.lng, 'low'),
      target: target(OSM_COURTS.lat, OSM_COURTS.lng),
      rec: { ...REC, coordinate_trade: goodTrade({ [k]: undefined }) },
    })
    expect(r.fatal).toMatch(new RegExp(`missing "${k}"`))
  })

  it('tolerates the 2 m rounding allowance but nothing wider', () => {
    const opts = { incoming: incoming(STREET_PIN.lat, STREET_PIN.lng, 'low'), target: target(OSM_COURTS.lat, OSM_COURTS.lng) }
    expect(check({ ...opts, rec: { ...REC, coordinate_trade: goodTrade({ distance_m: 413 }) } }).fatal).toBeNull()
    expect(check({ ...opts, rec: { ...REC, coordinate_trade: goodTrade({ distance_m: 417 }) } }).fatal).toBeNull()
    expect(check({ ...opts, rec: { ...REC, coordinate_trade: goodTrade({ distance_m: 412 }) } }).fatal).toBeTruthy()
  })
})

describe('ok — nothing is being given up', () => {
  // A `high` or `medium` incoming coordinate makes no degradation CLAIM, so the guard reports the
  // move and stands aside. Whether the two sources disagree about where the venue is at all is a
  // reconcile-IDENTITY question, already covered by matched_distance_m and the adjudication evidence.
  it.each(['high', 'medium'])('passes a %s incoming coordinate with a report only', (precision) => {
    const r = check({ incoming: incoming(28.7075117, -81.2750142, precision), target: target(OSM_COURTS.lat, OSM_COURTS.lng), rec: REC })
    expect(r.verdict).toBe('ok')
    expect(r.fatal).toBeNull()
    expect(r.report).toContain('m apart')
  })

  it('reports the distance on every reconcile, so a large move is visible even when legal', () => {
    const r = check({ incoming: incoming(28.75, -81.27, 'high'), target: target(OSM_COURTS.lat, OSM_COURTS.lng), rec: REC })
    expect(r.distance_m).toBeGreaterThan(4000)
    expect(r.fatal).toBeNull()
  })
})
