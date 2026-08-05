/**
 * The shared publish gate after ADR-16 (precision), ADR-17 (coverage-first) and ADR-18 (tiers).
 *
 * These tests exist because the gate was previously unreachable: it lived inside
 * import-metro-merged.mjs, which reads argv and process.exit()s at module scope, so nothing in it
 * could be imported and nothing in it could be tested. The behaviours that most need pinning are the
 * ones where two facts LOOK the same and are not:
 *   - a MISSING coordinate vs a LOW-PRECISION one     (ADR-16)
 *   - an UNPROVEN venue vs a REJECTED one             (ADR-17)
 *   - the GATE vs the FENCE                           (ADR-17 — the whole safety argument)
 *
 * publish-gate.mjs is plain ESM with no types, so tsc widens its exports to `object`. Typed wrappers
 * at the boundary keep `tsc --noEmit` green without loosening it.
 */
import { describe, expect, it } from 'vitest'
import {
  APPROXIMATE_PRECISION,
  BLOCKING_RESEARCH_STATUS,
  GATE_TEXT,
  PIPELINE_VERIFICATION_STATUS,
  gateReasons,
  isApproximateLocation,
  isGenericName,
  passesReleaseFence,
  verificationStatusFor,
} from '../publish-gate.mjs'
import { APPROXIMATE_PRECISION as APP_PRECISION_CLIENT } from '../../../lib/directory/locationPrecision'

type Row = Record<string, any>

const reasons = gateReasons as (row: Row) => string[]
const isApprox = isApproximateLocation as (p: unknown) => boolean
const generic = isGenericName as (n: unknown) => boolean
const fence = passesReleaseFence as (r: Row) => boolean
const tierFor = verificationStatusFor as (s: unknown) => string
const blocking = BLOCKING_RESEARCH_STATUS as Set<string>
const pipelineTiers = PIPELINE_VERIFICATION_STATUS as Set<string>

/** A row that passes every condition. Each test below breaks exactly one thing. */
const passing = {
  name: 'Ridgeland Tennis Center',
  lat: 32.4396800, lng: -90.1197610, precision: 'high', city: 'Ridgeland',
  slug: 'ridgeland-tennis-center-ridgeland-ms', access_type: 'public', research_status: 'verified',
}

describe('the gate — what it lets through', () => {
  it('publishes a fully-qualified row', () => {
    expect(reasons(passing)).toEqual([])
  })

  /** ADR-16. Before the ruling this returned ['coordinate precision low']. */
  it('PUBLISHES a low-precision row — it is labelled, not withheld', () => {
    expect(reasons({ ...passing, precision: 'low' })).toEqual([])
  })

  /**
   * ADR-17, and the single most consequential line in this file. `access_type` was a gate condition;
   * 378 draft rows carry 'unknown'. Many public park courts will never have a source stating access.
   */
  it('PUBLISHES access_type unknown, and null, which used to be a hold', () => {
    expect(reasons({ ...passing, access_type: 'unknown' })).toEqual([])
    expect(reasons({ ...passing, access_type: null })).toEqual([])
  })

  /**
   * ADR-17. `probable` means "believed real, not confirmed by a controlling entity" (ADR-14) — an
   * UNPROVEN venue. Coverage-first publishes those. 105 draft listings sit at this status.
   */
  it('PUBLISHES a probable candidate, which used to be a hold', () => {
    expect(reasons({ ...passing, research_status: 'probable' })).toEqual([])
    expect(reasons({ ...passing, research_status: 'pending' })).toEqual([])
    expect(reasons({ ...passing, research_status: 'unresolved' })).toEqual([])
  })

  /**
   * The reconciling pass has no candidate row for raw OSM drafts and parity imports, and passes
   * research_status: null for them. Absence of a staging row is not evidence against a listing —
   * treating it as blocking would un-publish live Phoenix rows.
   */
  it('does not block on a null research_status', () => {
    expect(reasons({ ...passing, research_status: null })).toEqual([])
  })
})

describe('the gate — what it still holds', () => {
  /**
   * THE LINE ADR-16 DID NOT MOVE, and the one most at risk of being "simplified" away by a reader
   * who takes the ruling as "precision no longer blocks". A missing coordinate is a different fact:
   * there is no pin to label.
   */
  it('HOLDS a row with no coordinate, which a label cannot fix', () => {
    expect(reasons({ ...passing, lat: null, lng: null, precision: null })).toEqual(['no coordinate'])
    expect(reasons({ ...passing, lat: 32.4, lng: null })).toEqual(['no coordinate'])
  })

  it('holds on the four structural conditions', () => {
    expect(reasons({ ...passing, name: null })).toEqual(['no name'])
    expect(reasons({ ...passing, name: '   ' })).toEqual(['no name'])
    expect(reasons({ ...passing, city: null })).toEqual(['no city'])
    expect(reasons({ ...passing, slug: null })).toEqual(['no slug'])
    expect(reasons({ ...passing, hasCandidate: false })).toEqual(['no linked candidate'])
  })

  it('holds a generic name — the "name" term means identifying, not merely present', () => {
    expect(reasons({ ...passing, name: 'Pickleball Courts' })).toEqual(['generic name'])
  })

  /**
   * ADR-17 narrowed the blocking set to CORRECTNESS verdicts. These are not "unproven", they are
   * "this row should not exist" — and a duplicate in the directory is worse than a missing venue.
   */
  it('holds every correctness verdict, and only those', () => {
    for (const status of ['duplicate', 'not_venue', 'not_pickleball', 'held']) {
      expect(reasons({ ...passing, research_status: status })).toEqual([`research_status=${status}`])
    }
    expect([...blocking].sort()).toEqual(['duplicate', 'held', 'not_pickleball', 'not_venue'])
  })

  /**
   * `held` is an explicit human "not this one" (owner ruling 2026-08-05). It sits in the blocking set
   * alongside the correctness verdicts deliberately, and this test is here so nobody removes it while
   * "finishing" the coverage-first change: coverage-first publishes unproven venues, not rejected
   * ones, and those are different decisions.
   */
  it('keeps held blocking — a rejected venue is not an unproven one', () => {
    expect(blocking.has('held')).toBe(true)
    expect(blocking.has('probable')).toBe(false)
  })

  it('reports every failing condition at once rather than the first', () => {
    expect(reasons({ name: null, lat: null, lng: null, city: null, slug: null, research_status: 'duplicate' }))
      .toEqual(['no name', 'no coordinate', 'no city', 'no slug', 'research_status=duplicate'])
  })

  /** The run log is the only place an operator sees the rule. A GATE_TEXT advertising a condition the
   *  code stopped applying is a log that lies. */
  it('GATE_TEXT describes the rule the code actually applies', () => {
    expect(GATE_TEXT).not.toContain('precision != low')
    expect(GATE_TEXT).not.toContain("access_type != unknown")
    expect(GATE_TEXT).not.toContain("research_status='verified'")
    expect(GATE_TEXT).toContain('coordinate present')
    expect(GATE_TEXT).toContain('city')
    expect(GATE_TEXT).toContain('ADR-17')
  })
})

/**
 * THE FENCE. This is the safety argument of the whole slice, so it is pinned rather than trusted:
 * 446 draft rows pass the gate above and every one of them carries verified_by = NULL. If the fence
 * ever returns true for those, an unrelated `publish-facilities.mjs --metro=…` run publishes them.
 */
describe('the release fence', () => {
  it('is verified_by, and nothing else', () => {
    expect(fence({ verified_by: 'toledo-2026-07-31' })).toBe(true)
    expect(fence({ verified_by: null })).toBe(false)
    expect(fence({})).toBe(false)
  })

  /**
   * enrichment_version used to satisfy the same expression. It must not: a Gemini-enriched raw OSM
   * row ("Pickleball Backyard" carries enrichment_version 'v1' and no verified_by) would then
   * publish itself on the next metro reconcile with nobody having released it.
   */
  it('is NOT satisfied by enrichment_version — enrichment is not a decision', () => {
    expect(fence({ verified_by: null, enrichment_version: 'v1' })).toBe(false)
  })

  /** A gate-passing row with no stamp is exactly the backlog case. Both must be true at once. */
  it('withholds a row that passes the gate but was never released', () => {
    const row = { ...passing, verified_by: null }
    expect(reasons(row)).toEqual([])
    expect(fence(row)).toBe(false)
  })
})

describe('isGenericName', () => {
  it('rejects names that identify nothing once pickleball terms are stripped', () => {
    for (const n of ['Pickleball', 'Pickle Ball', 'Pickleball Courts', '8 Pickleball Courts', 'Tennis Courts']) {
      expect(generic(n)).toBe(true)
    }
  })

  it('keeps names carrying a proper noun', () => {
    for (const n of ['Chicken N Pickle', 'The Picklr Draper', 'Overlook Park', 'Pickleball Backyard']) {
      expect(generic(n)).toBe(false)
    }
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
   * row the page would not caveat.
   */
  it('agrees with the client-side constant across the scripts/app boundary', () => {
    expect(APPROXIMATE_PRECISION).toBe(APP_PRECISION_CLIENT)
  })
})

/** ADR-18. The tier describes a row; it never gates one. */
describe('verificationStatusFor', () => {
  it('claims a controlling-entity source only for verified candidates', () => {
    expect(tierFor('verified')).toBe('source_verified')
  })

  it('tiers everything else as listed', () => {
    for (const s of ['probable', 'pending', 'unresolved', 'unresolved_unnamed', 'held', null, undefined]) {
      expect(tierFor(s)).toBe('listed')
    }
  })

  /**
   * The idempotent re-run case, which the list above does NOT cover and which reads as a surprise:
   * `--stage=publish` flips a candidate to research_status='published', so a second run tiers off
   * 'published' rather than 'verified'. The tier is only ever WRITTEN at --stage=listings, before any
   * publish has happened, so this never reaches a row — but `verificationStatusFor` is exported and a
   * future caller could hit it. Pinned so the behaviour is a decision rather than an accident.
   */
  it("tiers a re-run's 'published' candidate as listed, not source_verified", () => {
    expect(tierFor('published')).toBe('listed')
  })

  it('never claims human_verified — that is a human word, not a script one', () => {
    expect(pipelineTiers.has('human_verified')).toBe(false)
    expect([...pipelineTiers].sort()).toEqual(['listed', 'source_verified'])
  })
})
