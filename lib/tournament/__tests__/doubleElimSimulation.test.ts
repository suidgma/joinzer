import { describe, it, expect } from 'vitest'
import {
  doubleEliminationBracket,
  computeAdvancement,
  computeLbDrop,
  computeChampionshipAdvancement,
  computeBracketReset,
  type MatchRow,
} from '../bracketBuilder'

/**
 * Plays out a full power-of-two double-elimination bracket using the REAL
 * advancement functions, applied in the same order as the match-score route
 * (app/api/tournaments/[id]/matches/[matchId]/route.ts). team_1 always wins, so
 * the result is deterministic. This is the regression oracle for the LB engine:
 * before the rewrite, N=4 silently crowned two "champions" and N=8/16 deadlocked
 * with LB rounds that never filled.
 *
 * Bye (non-power-of-two) fields also exercise the route's induced-BYE cascade,
 * which this pure-function harness can't replicate — covered separately.
 */
function simulate(n: number) {
  const teams = Array.from({ length: n }, (_, i) => `t${i}`)
  const rows: MatchRow[] = (doubleEliminationBracket(teams, {}, 1, true) as any[]).map((r, i) => ({
    id: `m${i}`,
    round_number: r.round_number ?? null,
    match_number: r.match_number,
    match_stage: r.match_stage,
    team_1_registration_id: r.team_1_registration_id ?? null,
    team_2_registration_id: r.team_2_registration_id ?? null,
    winner_registration_id: r.winner_registration_id ?? null,
    status: r.status ?? 'scheduled',
  }))
  const byId = new Map(rows.map(r => [r.id, r]))
  const losses: Record<string, number> = {}
  const lbPlayers = new Set<string>()

  const apply = (u: { matchId: string; field: 'team_1_registration_id' | 'team_2_registration_id'; value: string } | null) => {
    if (!u) return
    const m = byId.get(u.matchId)
    if (m && m[u.field] == null) m[u.field] = u.value
  }

  let guard = 0
  while (guard++ < 1000) {
    const ready = rows.find(m => m.status !== 'completed' && m.team_1_registration_id && m.team_2_registration_id)
    if (!ready) break
    const winner = ready.team_1_registration_id!
    const loser = ready.team_2_registration_id!
    ready.winner_registration_id = winner
    ready.status = 'completed'
    losses[loser] = (losses[loser] ?? 0) + 1
    if (ready.match_stage === 'losers_bracket') { lbPlayers.add(winner); lbPlayers.add(loser) }

    apply(computeAdvancement(ready, rows))
    apply(computeLbDrop(ready, rows))
    apply(computeChampionshipAdvancement(ready, rows))
    const reset = computeBracketReset(ready, rows)
    if (reset) {
      const id = `reset-${rows.length}`
      const rm: MatchRow = { id, ...reset }
      rows.push(rm); byId.set(id, rm)
    }
  }
  return { rows, losses, lbPlayers, incomplete: rows.filter(m => m.status !== 'completed') }
}

describe('double-elimination — full bracket simulation (power of two)', () => {
  for (const n of [4, 8, 16]) {
    it(`N=${n}: completes, single champion, every other team eliminated at 2 losses`, () => {
      const { rows, losses, incomplete } = simulate(n)

      // Nothing left hanging — every slot filled and every match resolved.
      expect(incomplete.map(m => `${m.match_stage} r${m.round_number} #${m.match_number}`)).toEqual([])

      // Exactly one champion (<=1 loss); all n-1 others eliminated at exactly 2.
      const eliminated = Object.values(losses).filter(l => l === 2).length
      expect(eliminated).toBe(n - 1)
      expect(n - eliminated).toBe(1)

      // Standard match count: WB (n-1) + LB (n-2) + championship (1, +1 reset here
      // since team_1 of the championship — the LB champ — wins). Sanity floor:
      expect(rows.length).toBeGreaterThanOrEqual(2 * n - 2)
    })
  }

  it('the winners-bracket-final loser still plays in the losers bracket', () => {
    // N=4: WB final is m2 (winners r2). Its loser must appear in an LB match.
    const { lbPlayers } = simulate(4)
    // 4 teams, 1 champion, 3 eliminated — all 3 non-champions pass through the LB.
    expect(lbPlayers.size).toBe(3)
  })
})
