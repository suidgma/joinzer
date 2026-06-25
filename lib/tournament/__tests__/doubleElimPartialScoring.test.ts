import { describe, it, expect } from 'vitest'
import { doubleEliminationBracket, type MatchRow } from '../bracketBuilder'
import { resolveCompletion } from '../resolveCompletion'

// Builds an N-team double-elim bracket as MatchRow[] (seed order, no shuffle).
function buildRows(n: number): MatchRow[] {
  return (doubleEliminationBracket(Array.from({ length: n }, (_, i) => `t${i}`), {}, 1, true) as any[])
    .map((r, i) => ({
      id: `m${i}`,
      round_number: r.round_number ?? null,
      match_number: r.match_number,
      match_stage: r.match_stage,
      team_1_registration_id: r.team_1_registration_id ?? null,
      team_2_registration_id: r.team_2_registration_id ?? null,
      winner_registration_id: r.winner_registration_id ?? null,
      status: r.status ?? 'scheduled',
    }))
}

// Score a match (team_1 wins) and apply resolveCompletion's mutations exactly the
// way the score route does — so this exercises the real production advancement path.
function scoreT1Wins(rows: MatchRow[], matchId: string) {
  const m = rows.find(r => r.id === matchId)!
  m.winner_registration_id = m.team_1_registration_id
  m.status = 'completed'
  for (const mut of resolveCompletion(m, rows)) {
    if (mut.kind === 'set') {
      const t = rows.find(r => r.id === mut.matchId)!
      if (t[mut.field] == null) t[mut.field] = mut.value
    } else if (mut.kind === 'complete') {
      const t = rows.find(r => r.id === mut.matchId)!
      if (t.status !== 'completed') { t.status = 'completed'; t.winner_registration_id = mut.winner }
    } else {
      rows.push({ ...mut.match })
    }
  }
}

const inStage = (rows: MatchRow[], stage: string, round: number) =>
  rows.filter(r => r.match_stage === stage && r.round_number === round)
    .sort((a, b) => a.match_number - b.match_number)

describe('double-elim — no premature losers-bracket advancement (partial scoring)', () => {
  it('N=8: scoring all of WB R1 fills LB R1 but leaves LB R2 empty until LB R1 is played', () => {
    const rows = buildRows(8)
    for (const m of inStage(rows, 'winners_bracket', 1)) scoreT1Wins(rows, m.id)

    // LB R1 is fully populated by the four WB R1 losers — and not auto-completed.
    for (const m of inStage(rows, 'losers_bracket', 1)) {
      expect(m.team_1_registration_id).not.toBeNull()
      expect(m.team_2_registration_id).not.toBeNull()
      expect(m.status).not.toBe('completed')
    }
    // LB R2 must still be empty: nobody advances before their LB R1 match is scored.
    for (const m of inStage(rows, 'losers_bracket', 2)) {
      expect(m.team_1_registration_id).toBeNull()
      expect(m.team_2_registration_id).toBeNull()
    }
  })

  it('N=8: an LB R2 slot fills only after BOTH its feeders (an LB R1 match and a WB R2 match) are scored', () => {
    const rows = buildRows(8)
    for (const m of inStage(rows, 'winners_bracket', 1)) scoreT1Wins(rows, m.id)

    // Score one LB R1 match → its winner should drop into LB R2 team_1, but the
    // LB R2 team_2 (a WB R2 loser) is still pending, so the match stays unscored.
    const lbR1 = inStage(rows, 'losers_bracket', 1)
    scoreT1Wins(rows, lbR1[0].id)
    const lbR2 = inStage(rows, 'losers_bracket', 2)
    expect(lbR2[0].team_1_registration_id).not.toBeNull()
    expect(lbR2[0].team_2_registration_id).toBeNull()
    expect(lbR2[0].status).not.toBe('completed')

    // Now score the feeding WB R2 (semi) match → its loser drops into LB R2 team_2.
    scoreT1Wins(rows, inStage(rows, 'winners_bracket', 2)[0].id)
    expect(lbR2[0].team_2_registration_id).not.toBeNull()
  })
})
