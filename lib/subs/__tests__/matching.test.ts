import { describe, it, expect } from 'vitest'
import {
  evaluateEligibility,
  rankScore,
  ratingWarning,
  ratingCloseness,
  urgencyScore,
  type OpportunityInput,
  type Viewer,
} from '../matching'

const TODAY = '2026-07-20'
const NOW = new Date('2026-07-20T12:00:00Z')

function viewer(over: Partial<Viewer> = {}): Viewer {
  return { id: 'U1', gender: 'male', isStub: false, homeCourtId: null, rating: 3.5, ...over }
}

function opp(over: Partial<OpportunityInput> = {}): OpportunityInput {
  return {
    requestId: 'R1', leagueId: 'L1', leagueName: 'RR', leagueFormat: 'open_singles', formatKind: 'session_rr',
    organizerId: 'O1', skillMin: 3.0, skillMax: 4.0, locationId: 'LOC1', venueName: 'Court',
    scopeType: 'session', scopeId: 'S1', requesterId: 'REQ', genderRequired: null,
    date: '2026-07-25', startTime: '18:30:00', createdAt: '2026-07-19T00:00:00Z', expiresAt: null,
    occasionStarted: false, generated: false, viewerAlreadyInOccasion: false, viewerScheduleConflict: false,
    viewerPriorParticipant: false, viewerPriorSub: false, viewerSameOrganizer: false, ...over,
  }
}

describe('evaluateEligibility — hard gates', () => {
  it('eligible RR opportunity passes', () => {
    expect(evaluateEligibility(opp(), viewer(), TODAY, NOW).eligible).toBe(true)
  })
  it('eligible box opportunity passes', () => {
    expect(evaluateEligibility(opp({ scopeType: 'period', formatKind: 'box', date: null, startTime: null }), viewer(), TODAY, NOW).eligible).toBe(true)
  })
  it('eligible ladder opportunity passes', () => {
    expect(evaluateEligibility(opp({ scopeType: 'period', formatKind: 'ladder', date: null }), viewer(), TODAY, NOW).eligible).toBe(true)
  })
  it('requester is excluded (own_request)', () => {
    const r = evaluateEligibility(opp({ requesterId: 'U1' }), viewer(), TODAY, NOW)
    expect(r).toEqual({ eligible: false, reason: 'own_request' })
  })
  it('duplicate participant excluded', () => {
    expect(evaluateEligibility(opp({ viewerAlreadyInOccasion: true }), viewer(), TODAY, NOW)).toEqual({ eligible: false, reason: 'duplicate_participation' })
  })
  it('gender mismatch excluded (mens league, female viewer)', () => {
    expect(evaluateEligibility(opp({ leagueFormat: 'mens_singles' }), viewer({ gender: 'female' }), TODAY, NOW)).toEqual({ eligible: false, reason: 'gender_mismatch' })
  })
  it('gender rule from request column also applies', () => {
    expect(evaluateEligibility(opp({ genderRequired: 'female' }), viewer({ gender: 'male' }), TODAY, NOW)).toEqual({ eligible: false, reason: 'gender_mismatch' })
  })
  it('generated occasion excluded', () => {
    expect(evaluateEligibility(opp({ generated: true }), viewer(), TODAY, NOW)).toEqual({ eligible: false, reason: 'generation_started' })
  })
  it('started occasion excluded (flag)', () => {
    expect(evaluateEligibility(opp({ occasionStarted: true }), viewer(), TODAY, NOW)).toEqual({ eligible: false, reason: 'occasion_started' })
  })
  it('past-dated RR session excluded', () => {
    expect(evaluateEligibility(opp({ date: '2026-07-01' }), viewer(), TODAY, NOW)).toEqual({ eligible: false, reason: 'occasion_started' })
  })
  it('expired request excluded', () => {
    expect(evaluateEligibility(opp({ expiresAt: '2026-07-20T00:00:00Z' }), viewer(), TODAY, NOW)).toEqual({ eligible: false, reason: 'request_expired' })
  })
  it('unsupported format excluded', () => {
    expect(evaluateEligibility(opp({ formatKind: 'team' }), viewer(), TODAY, NOW)).toEqual({ eligible: false, reason: 'unsupported_format' })
  })
  it('schedule conflict excluded', () => {
    expect(evaluateEligibility(opp({ viewerScheduleConflict: true }), viewer(), TODAY, NOW)).toEqual({ eligible: false, reason: 'schedule_conflict' })
  })
  it('stub account excluded', () => {
    expect(evaluateEligibility(opp(), viewer({ isStub: true }), TODAY, NOW)).toEqual({ eligible: false, reason: 'accepter_ineligible' })
  })
  it('rating mismatch is NOT a hard gate (stays eligible)', () => {
    expect(evaluateEligibility(opp({ skillMin: 4.5, skillMax: 5.0 }), viewer({ rating: 2.5 }), TODAY, NOW).eligible).toBe(true)
  })
})

describe('rankScore — soft ranking', () => {
  it('sooner opportunity ranks higher', () => {
    const soon = rankScore(opp({ date: '2026-07-21' }), viewer(), TODAY)
    const later = rankScore(opp({ date: '2026-07-30' }), viewer(), TODAY)
    expect(soon).toBeGreaterThan(later)
  })
  it('prior league participation boosts', () => {
    expect(rankScore(opp({ viewerPriorParticipant: true }), viewer(), TODAY)).toBeGreaterThan(rankScore(opp(), viewer(), TODAY))
  })
  it('prior sub history boosts', () => {
    expect(rankScore(opp({ viewerPriorSub: true }), viewer(), TODAY)).toBeGreaterThan(rankScore(opp(), viewer(), TODAY))
  })
  it('rating closeness boosts', () => {
    const close = rankScore(opp(), viewer({ rating: 3.5 }), TODAY) // mid of 3-4
    const far = rankScore(opp(), viewer({ rating: 1.0 }), TODAY)
    expect(close).toBeGreaterThan(far)
  })
  it('home-court match boosts', () => {
    expect(rankScore(opp({ locationId: 'X' }), viewer({ homeCourtId: 'X' }), TODAY)).toBeGreaterThan(rankScore(opp({ locationId: 'X' }), viewer({ homeCourtId: 'Y' }), TODAY))
  })
  it('missing optional data does not throw and yields a finite score', () => {
    const s = rankScore(opp({ skillMin: null, skillMax: null, locationId: null }), viewer({ rating: null, homeCourtId: null }), TODAY)
    expect(Number.isFinite(s)).toBe(true)
  })
  it('deterministic for identical inputs', () => {
    expect(rankScore(opp(), viewer(), TODAY)).toBe(rankScore(opp(), viewer(), TODAY))
  })
})

describe('ratingCloseness + urgency', () => {
  it('closeness is 1 at the band midpoint, 0 when far or unknown', () => {
    expect(ratingCloseness(opp({ skillMin: 3, skillMax: 4 }), viewer({ rating: 3.5 }))).toBe(1)
    expect(ratingCloseness(opp({ skillMin: 3, skillMax: 4 }), viewer({ rating: 6 }))).toBe(0)
    expect(ratingCloseness(opp(), viewer({ rating: null }))).toBe(0)
  })
  it('urgency: today=100, periods high-fixed', () => {
    expect(urgencyScore(opp({ date: TODAY }), TODAY)).toBe(100)
    expect(urgencyScore(opp({ scopeType: 'period', date: null }), TODAY)).toBe(80)
  })
})

describe('ratingWarning — display only', () => {
  it('flags a meaningful mismatch but stays visible', () => {
    const w = ratingWarning(opp({ skillMin: 4.5, skillMax: 5.0 }), viewer({ rating: 2.5 }))
    expect(w.mismatch).toBe(true)
    expect(w.text).toContain('4.5')
    expect(w.recommended).toBe('Recommended rating: 4.5–5.0')
  })
  it('no warning inside the comfort band', () => {
    expect(ratingWarning(opp({ skillMin: 3, skillMax: 4 }), viewer({ rating: 3.5 })).mismatch).toBe(false)
  })
  it('no false precision when rating or band missing', () => {
    expect(ratingWarning(opp({ skillMin: null, skillMax: null }), viewer({ rating: 3.5 })).mismatch).toBe(false)
    expect(ratingWarning(opp(), viewer({ rating: null })).mismatch).toBe(false)
  })
})
