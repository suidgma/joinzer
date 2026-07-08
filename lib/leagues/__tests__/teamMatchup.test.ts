import { describe, it, expect } from 'vitest'
import { validateLineup, rollUpMatchup, type LineChild } from '../teamMatchup'

// A 3-line matchup: Line 1 singles, Lines 2–3 doubles. Team A roster a1..a4, Team B b1..b4.
const LINES = [{ discipline: 'singles' }, { discipline: 'doubles' }, { discipline: 'doubles' }]
const rosterA = new Set(['a1', 'a2', 'a3', 'a4'])
const rosterB = new Set(['b1', 'b2', 'b3', 'b4'])
const goodLineup = [
  { team1: ['a1'], team2: ['b1'] },
  { team1: ['a2', 'a3'], team2: ['b2', 'b3'] },
  { team1: ['a4', 'a1'], team2: ['b4', 'b1'] },
]

describe('validateLineup', () => {
  it('accepts a valid lineup and returns ordered rows with the doubles partner columns', () => {
    const res = validateLineup(LINES, goodLineup, rosterA, rosterB, /* allowMulti */ true)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.rows).toHaveLength(3)
    expect(res.rows[0]).toEqual({ match_number: 1, team_1_registration_id: 'a1', team_1_partner_registration_id: null, team_2_registration_id: 'b1', team_2_partner_registration_id: null })
    expect(res.rows[1]).toEqual({ match_number: 2, team_1_registration_id: 'a2', team_1_partner_registration_id: 'a3', team_2_registration_id: 'b2', team_2_partner_registration_id: 'b3' })
  })

  it('rejects a lineup that does not cover every line', () => {
    expect(validateLineup(LINES, goodLineup.slice(0, 2), rosterA, rosterB, true)).toEqual({ ok: false, error: 'Lineup must cover every line' })
  })

  it('rejects the wrong number of players per side (singles line given 2)', () => {
    const bad = [{ team1: ['a1', 'a2'], team2: ['b1'] }, goodLineup[1], goodLineup[2]]
    expect(validateLineup(LINES, bad, rosterA, rosterB, true)).toEqual({ ok: false, error: 'Line 1 needs 1 player per side' })
  })

  it('rejects a doubles line missing a partner', () => {
    const bad = [goodLineup[0], { team1: ['a2'], team2: ['b2', 'b3'] }, goodLineup[2]]
    expect(validateLineup(LINES, bad, rosterA, rosterB, true)).toEqual({ ok: false, error: 'Line 2 needs 2 players per side' })
  })

  it('rejects a duplicate player within one doubles line', () => {
    const bad = [goodLineup[0], { team1: ['a2', 'a2'], team2: ['b2', 'b3'] }, goodLineup[2]]
    expect(validateLineup(LINES, bad, rosterA, rosterB, true)).toEqual({ ok: false, error: 'Line 2 has a duplicate player' })
  })

  it("rejects a player who isn't on that team's roster", () => {
    const bad = [{ team1: ['a1'], team2: ['x9'] }, goodLineup[1], goodLineup[2]]
    expect(validateLineup(LINES, bad, rosterA, rosterB, true)).toEqual({ ok: false, error: "Line 1: a selected player isn't on that team's roster" })
  })

  it('rejects sides swapped (team_1 given a team_2 player)', () => {
    const bad = [{ team1: ['b1'], team2: ['a1'] }, goodLineup[1], goodLineup[2]]
    expect(validateLineup(LINES, bad, rosterA, rosterB, true)).toEqual({ ok: false, error: "Line 1: a selected player isn't on that team's roster" })
  })

  it('enforces one-line-per-player when allowMulti is false (a1 reused on line 3)', () => {
    // goodLineup reuses a1 on line 1 and line 3 → violation only when multi is disallowed.
    expect(validateLineup(LINES, goodLineup, rosterA, rosterB, false)).toEqual({ ok: false, error: 'A player is assigned to more than one line' })
    expect(validateLineup(LINES, goodLineup, rosterA, rosterB, true).ok).toBe(true)
  })
})

// ── Roll-up ──────────────────────────────────────────────────────────────────────
const child = (id: string, a: string, b: string, s1: number | null = null, s2: number | null = null, status = 'scheduled'): LineChild => ({
  id, team_1_registration_id: a, team_2_registration_id: b, team_1_score: s1, team_2_score: s2, status,
})
// Three fresh (unscored) line fixtures for a T1-vs-T2 matchup.
const fresh = () => [child('L1', 'a1', 'b1'), child('L2', 'a2', 'b2'), child('L3', 'a4', 'b4')]

describe('rollUpMatchup', () => {
  it('a clean 2–1 win: winner is the team that took more lines, matchup completed', () => {
    const provided = new Map([
      ['L1', { team_1_score: 11, team_2_score: 6 }], // A
      ['L2', { team_1_score: 9, team_2_score: 11 }], // B
      ['L3', { team_1_score: 11, team_2_score: 4 }], // A
    ])
    const r = rollUpMatchup(fresh(), provided, 'T1', 'T2')
    expect(r.team1Lines).toBe(2)
    expect(r.team2Lines).toBe(1)
    expect(r.winnerTeamId).toBe('T1')
    expect(r.completed).toBe(true)
    // Each child update carries the per-line winner registration.
    expect(r.childUpdates.find((c) => c.id === 'L1')!.winner_registration_id).toBe('a1')
    expect(r.childUpdates.find((c) => c.id === 'L2')!.winner_registration_id).toBe('b2')
    expect(r.childUpdates).toHaveLength(3)
  })

  it('an even split is a completed matchup with NO winner (tie)', () => {
    const twoLines = [child('L1', 'a1', 'b1'), child('L2', 'a2', 'b2')]
    const provided = new Map([
      ['L1', { team_1_score: 11, team_2_score: 3 }], // A
      ['L2', { team_1_score: 5, team_2_score: 11 }], // B
    ])
    const r = rollUpMatchup(twoLines, provided, 'T1', 'T2')
    expect(r.team1Lines).toBe(1)
    expect(r.team2Lines).toBe(1)
    expect(r.completed).toBe(true)
    expect(r.winnerTeamId).toBeNull()
  })

  it('a partial save is not completed and has no winner yet, but tallies what is scored', () => {
    const provided = new Map([['L1', { team_1_score: 11, team_2_score: 2 }]]) // only line 1
    const r = rollUpMatchup(fresh(), provided, 'T1', 'T2')
    expect(r.team1Lines).toBe(1)
    expect(r.team2Lines).toBe(0)
    expect(r.completed).toBe(false)
    expect(r.winnerTeamId).toBeNull()
    expect(r.childUpdates).toHaveLength(1)
  })

  it('accumulates: a new save merges with already-scored lines from the DB', () => {
    // L1 already completed for A in the DB; now we submit L2 (B) and L3 (A).
    const stored = [
      child('L1', 'a1', 'b1', 11, 7, 'completed'),
      child('L2', 'a2', 'b2'),
      child('L3', 'a4', 'b4'),
    ]
    const provided = new Map([
      ['L2', { team_1_score: 8, team_2_score: 11 }], // B
      ['L3', { team_1_score: 11, team_2_score: 9 }], // A
    ])
    const r = rollUpMatchup(stored, provided, 'T1', 'T2')
    expect(r.team1Lines).toBe(2) // L1 (stored) + L3 (new)
    expect(r.team2Lines).toBe(1) // L2 (new)
    expect(r.completed).toBe(true)
    expect(r.winnerTeamId).toBe('T1')
    expect(r.childUpdates).toHaveLength(2) // only the newly-provided lines are written
  })

  it('re-scoring a completed line flips the result', () => {
    // Stored 2–1 for A (L1 A, L2 B, L3 A). Re-submit only L1 for B → L1 B, L2 B, L3 A
    // → 1–2, T2 wins. Confirms a single re-score overrides the stored line and re-tallies.
    const stored = [
      child('L1', 'a1', 'b1', 11, 6, 'completed'),
      child('L2', 'a2', 'b2', 9, 11, 'completed'),
      child('L3', 'a4', 'b4', 11, 4, 'completed'),
    ]
    const provided = new Map([['L1', { team_1_score: 5, team_2_score: 11 }]]) // now B
    const r = rollUpMatchup(stored, provided, 'T1', 'T2')
    expect(r.team1Lines).toBe(1) // L3
    expect(r.team2Lines).toBe(2) // L1 (re-scored) + L2
    expect(r.winnerTeamId).toBe('T2')
    expect(r.completed).toBe(true)
  })
})
