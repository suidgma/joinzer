/**
 * The shared publish gate after ADR-16.
 *
 * These tests exist because the gate was previously unreachable: it lived inside
 * import-metro-merged.mjs, which reads argv and process.exit()s at module scope, so nothing in it
 * could be imported and nothing in it could be tested. The behaviour that most needed pinning — that
 * a MISSING coordinate and a LOW-PRECISION coordinate are different facts with different outcomes —
 * had no coverage at all when the two were both simply "held".
 *
 * geocode/publish-gate are plain ESM with no types, so tsc widens their exports to `object`. One
 * local alias plus typed wrappers at the boundary keeps `tsc --noEmit` green without loosening it.
 */
import { describe, expect, it } from 'vitest'
import {
  APPROXIMATE_PRECISION,
  GATE_TEXT,
  gateReasons,
  isApproximateLocation,
} from '../publish-gate.mjs'
import { APPROXIMATE_PRECISION as APP_PRECISION_CLIENT } from '../../../lib/directory/locationPrecision'

type Row = Record<string, any>

const reasons = gateReasons as (row: Row) => string[]
const isApprox = isApproximateLocation as (p: unknown) => boolean

/** A row that passes every condition. Each test below breaks exactly one thing. */
const passing = {
  lat: 32.4396800, lng: -90.1197610, precision: 'high',
  slug: 'ridgeland-tennis-center-ridgeland-ms', access_type: 'public', research_status: 'verified',
}

describe('gateReasons after ADR-16', () => {
  it('publishes a fully-qualified row', () => {
    expect(reasons(passing)).toEqual([])
  })

  /**
   * THE WHOLE OF ADR-16 ON THE IMPORTER SIDE. Before the ruling this returned
   * ['coordinate precision low']; 91 rows across 32 metros were held by exactly this line.
   */
  it('PUBLISHES a low-precision row — it is labelled, not withheld', () => {
    expect(reasons({ ...passing, precision: 'low' })).toEqual([])
  })

  it('publishes medium precision, which was never a hold', () => {
    expect(reasons({ ...passing, precision: 'medium' })).toEqual([])
  })

  /**
   * THE LINE ADR-16 DID NOT MOVE, and the one most at risk of being "simplified" away by a future
   * reader who reads the ruling as "precision no longer blocks". A missing coordinate is a different
   * fact: there is no pin to label. 115 of the 348 held drafts are in this state and stay held.
   */
  it('still HOLDS a row with no coordinate, which a label cannot fix', () => {
    expect(reasons({ ...passing, lat: null, lng: null, precision: null })).toEqual(['no coordinate'])
    expect(reasons({ ...passing, lat: 32.4, lng: null })).toEqual(['no coordinate'])
  })

  it('still holds on every other condition', () => {
    expect(reasons({ ...passing, slug: null })).toEqual(['no slug'])
    expect(reasons({ ...passing, access_type: 'unknown' })).toEqual(['access_type unknown'])
    expect(reasons({ ...passing, access_type: null })).toEqual(['access_type unknown'])
    expect(reasons({ ...passing, research_status: 'probable' })).toEqual(['research_status=probable'])
    expect(reasons({ ...passing, hasCandidate: false })).toEqual(['no linked candidate'])
  })

  it('reports every failing condition at once rather than the first', () => {
    expect(reasons({ lat: null, lng: null, precision: 'low', slug: null, access_type: 'unknown', research_status: 'probable' }))
      .toEqual(['no coordinate', 'no slug', 'access_type unknown', 'research_status=probable'])
  })

  /** The run log is the only place an operator sees the rule. A GATE_TEXT still advertising
   *  `precision != low` while the code publishes those rows is a log that lies. */
  it('GATE_TEXT no longer advertises precision as a hold condition', () => {
    expect(GATE_TEXT).not.toContain('precision != low')
    expect(GATE_TEXT).toContain('ADR-16')
    expect(GATE_TEXT).toContain('coordinate present')
  })
})

describe('isApproximateLocation', () => {
  it('is true only for low', () => {
    expect(isApprox('low')).toBe(true)
    expect(isApprox('medium')).toBe(false)
    expect(isApprox('high')).toBe(false)
    expect(isApprox(null)).toBe(false)
    expect(isApprox(undefined)).toBe(false)
  })

  /**
   * The scripts are plain ESM and are never imported by the Next app, so the constant is stated on
   * both sides of that boundary rather than shared across it. This is the assertion that stops the
   * duplication from drifting: if someone renames the precision tier in one place, the gate and the
   * label would silently disagree about which rows are approximate — the importer would publish a
   * row the page would not caveat. That is the precise failure this slice exists to prevent.
   */
  it('agrees with the client-side constant across the scripts/app boundary', () => {
    expect(APPROXIMATE_PRECISION).toBe(APP_PRECISION_CLIENT)
  })
})
