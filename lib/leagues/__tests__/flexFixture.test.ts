import { describe, it, expect } from 'vitest'
import { resolveActingSide, reportResult, confirmResult, disputeResult, resolveResult, organizerSetResult, type FlexFixtureState, type EntrantSides } from '../flexFixture'

// Singles fixture: side 1 = reg r1 (user u1), side 2 = reg r2 (user u2).
const sides: EntrantSides = { team_1: new Set(['u1']), team_2: new Set(['u2']) }
// Fixed-doubles: side 1 = canonical reg rA (users u1a/u1b), side 2 = rB (u2a/u2b).
const doublesSides: EntrantSides = { team_1: new Set(['u1a', 'u1b']), team_2: new Set(['u2a', 'u2b']) }

const base = (over: Partial<FlexFixtureState> = {}): FlexFixtureState => ({
  status: 'scheduled',
  team_1_registration_id: 'r1',
  team_2_registration_id: 'r2',
  reported_by: null,
  ...over,
})

describe('resolveActingSide', () => {
  it('maps a user to their side, or null when not a participant', () => {
    expect(resolveActingSide(sides, 'u1')).toBe('team_1')
    expect(resolveActingSide(sides, 'u2')).toBe('team_2')
    expect(resolveActingSide(sides, 'stranger')).toBeNull()
  })
  it('resolves either partner of a doubles entrant to that side', () => {
    expect(resolveActingSide(doublesSides, 'u1b')).toBe('team_1')
    expect(resolveActingSide(doublesSides, 'u2a')).toBe('team_2')
  })
})

describe('reportResult', () => {
  it('an entrant reports → scores, winner, reporter, and awaiting-confirm (in_progress)', () => {
    const r = reportResult(base(), sides, 'u1', false, 11, 6)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.patch).toEqual({ team_1_score: 11, team_2_score: 6, winner_registration_id: 'r1', reported_by: 'u1', confirmed_by: null, status: 'in_progress' })
  })

  it('winner is the side-2 entrant when they score higher', () => {
    const r = reportResult(base(), sides, 'u2', false, 7, 11)
    expect(r.ok && r.patch.winner_registration_id).toBe('r2')
  })

  it('rejects a tie', () => {
    expect(reportResult(base(), sides, 'u1', false, 9, 9)).toMatchObject({ ok: false })
  })

  it('rejects a non-participant', () => {
    expect(reportResult(base(), sides, 'stranger', false, 11, 6)).toMatchObject({ ok: false, status: 403 })
  })

  it('lets the organizer report on behalf even if not an entrant', () => {
    expect(reportResult(base(), sides, 'org', true, 11, 6).ok).toBe(true)
  })

  it('refuses to report a completed or disputed match', () => {
    expect(reportResult(base({ status: 'completed' }), sides, 'u1', false, 11, 6)).toMatchObject({ ok: false, status: 409 })
    expect(reportResult(base({ status: 'disputed' }), sides, 'u1', false, 11, 6)).toMatchObject({ ok: false, status: 409 })
  })

  it('allows a re-report while still awaiting confirmation (overwrites the pending report)', () => {
    const r = reportResult(base({ status: 'in_progress', reported_by: 'u1' }), sides, 'u1', false, 11, 9)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.patch.confirmed_by).toBeNull()
  })
})

describe('confirmResult', () => {
  const reported = base({ status: 'in_progress', reported_by: 'u1' })

  it('the opposing entrant confirms → completed', () => {
    const r = confirmResult(reported, sides, 'u2', false)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.patch).toEqual({ confirmed_by: 'u2', status: 'completed' })
  })

  it('the reporter cannot confirm their own result', () => {
    expect(confirmResult(reported, sides, 'u1', false)).toMatchObject({ ok: false, status: 403 })
  })

  it('a non-participant cannot confirm', () => {
    expect(confirmResult(reported, sides, 'stranger', false)).toMatchObject({ ok: false, status: 403 })
  })

  it('the organizer can confirm', () => {
    expect(confirmResult(reported, sides, 'org', true).ok).toBe(true)
  })

  it('there is nothing to confirm unless a result was reported (in_progress)', () => {
    expect(confirmResult(base({ status: 'scheduled' }), sides, 'u2', false)).toMatchObject({ ok: false, status: 409 })
    expect(confirmResult(base({ status: 'completed' }), sides, 'u2', false)).toMatchObject({ ok: false, status: 409 })
  })

  it('doubles: the opposing pair may confirm the reporter pair', () => {
    const dReported = base({ status: 'in_progress', reported_by: 'u1a', team_1_registration_id: 'rA', team_2_registration_id: 'rB' })
    expect(confirmResult(dReported, doublesSides, 'u2b', false).ok).toBe(true) // partner of side 2 confirms
    expect(confirmResult(dReported, doublesSides, 'u1b', false)).toMatchObject({ ok: false }) // reporter's own pair can't
  })
})

describe('disputeResult', () => {
  const reported = base({ status: 'in_progress', reported_by: 'u1' })

  it('the opposing entrant disputes → disputed', () => {
    const r = disputeResult(reported, sides, 'u2', false)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.patch).toEqual({ status: 'disputed' })
  })

  it('the reporter cannot dispute their own report', () => {
    expect(disputeResult(reported, sides, 'u1', false)).toMatchObject({ ok: false, status: 403 })
  })

  it('cannot dispute a match that has no reported result', () => {
    expect(disputeResult(base({ status: 'scheduled' }), sides, 'u2', false)).toMatchObject({ ok: false, status: 409 })
  })
})

describe('resolveResult', () => {
  const disputed = base({ status: 'disputed', reported_by: 'u1' })

  it('the organizer sets the final score → completed', () => {
    const r = resolveResult(disputed, true, 11, 4)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.patch).toEqual({ team_1_score: 11, team_2_score: 4, winner_registration_id: 'r1', confirmed_by: null, status: 'completed' })
  })

  it('a non-organizer cannot resolve', () => {
    expect(resolveResult(disputed, false, 11, 4)).toMatchObject({ ok: false, status: 403 })
  })

  it('rejects a tie on resolve', () => {
    expect(resolveResult(disputed, true, 8, 8)).toMatchObject({ ok: false })
  })

  it('will not resolve an already-finalized match', () => {
    expect(resolveResult(base({ status: 'completed' }), true, 11, 4)).toMatchObject({ ok: false, status: 409 })
  })
})

describe('organizerSetResult (organizer edit/override)', () => {
  it('edits an already-completed match → new score, completed', () => {
    const r = organizerSetResult(base({ status: 'completed' }), true, 9, 11)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.patch).toEqual({ team_1_score: 9, team_2_score: 11, winner_registration_id: 'r2', confirmed_by: null, status: 'completed' })
  })

  it('sets a score on a not-yet-played match', () => {
    const r = organizerSetResult(base({ status: 'scheduled' }), true, 11, 6)
    expect(r.ok && r.patch.status).toBe('completed')
  })

  it('a non-organizer cannot edit', () => {
    expect(organizerSetResult(base({ status: 'completed' }), false, 11, 4)).toMatchObject({ ok: false, status: 403 })
  })

  it('rejects a tie', () => {
    expect(organizerSetResult(base({ status: 'completed' }), true, 8, 8)).toMatchObject({ ok: false })
  })

  it('will not edit a forfeited or cancelled match', () => {
    expect(organizerSetResult(base({ status: 'forfeited' }), true, 11, 4)).toMatchObject({ ok: false, status: 409 })
    expect(organizerSetResult(base({ status: 'cancelled' }), true, 11, 4)).toMatchObject({ ok: false, status: 409 })
  })
})
