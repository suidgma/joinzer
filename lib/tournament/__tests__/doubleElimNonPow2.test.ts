import { describe, it, expect } from 'vitest'
import { doubleEliminationBracket, type MatchRow } from '../bracketBuilder'
import { computeByeAdvancements } from '../advanceByes'
import { resolveCompletion, phantomMatchIds, type Mutation } from '../resolveCompletion'

function buildRows(n: number): MatchRow[] {
  const teams = Array.from({ length: n }, (_, i) => `t${i}`)
  return (doubleEliminationBracket(teams, {}, 1, true) as Array<Record<string, unknown>>).map((r, i) => ({
    id: `m${i}`,
    round_number: (r.round_number as number) ?? null,
    match_number: r.match_number as number,
    match_stage: r.match_stage as string,
    team_1_registration_id: (r.team_1_registration_id as string) ?? null,
    team_2_registration_id: (r.team_2_registration_id as string) ?? null,
    winner_registration_id: (r.winner_registration_id as string) ?? null,
    status: (r.status as string) ?? 'scheduled',
  }))
}

// Full-fidelity play-out of the REAL production pipeline. Builds a double-elim
// bracket and settles generation-time byes exactly as the generate route does
// (computeByeAdvancements), then plays every match exactly as the match-score route
// does: score it, call resolveCompletion, apply the mutations. Deterministic (the
// chosen winner is configurable). This is the oracle that the non-power-of-2 losers
// bracket must satisfy for EVERY field size.

type WinnerPick = (m: MatchRow) => string // returns the team id that should win

function simulate(n: number, pick: WinnerPick) {
  const teams = Array.from({ length: n }, (_, i) => `t${i}`)
  const rows: MatchRow[] = (doubleEliminationBracket(teams, {}, 1, true) as Array<Record<string, unknown>>).map((r, i) => ({
    id: `m${i}`,
    round_number: (r.round_number as number) ?? null,
    match_number: r.match_number as number,
    match_stage: r.match_stage as string,
    team_1_registration_id: (r.team_1_registration_id as string) ?? null,
    team_2_registration_id: (r.team_2_registration_id as string) ?? null,
    winner_registration_id: (r.winner_registration_id as string) ?? null,
    status: (r.status as string) ?? 'scheduled',
  }))
  const byId = new Map(rows.map(r => [r.id, r]))
  const losses: Record<string, number> = {}

  const apply = (mu: Mutation) => {
    if (mu.kind === 'set') { const m = byId.get(mu.matchId); if (m && m[mu.field] == null) m[mu.field] = mu.value }
    else if (mu.kind === 'complete') { const m = byId.get(mu.matchId); if (m && m.status !== 'completed') { m.winner_registration_id = mu.winner; m.status = 'completed' } }
    else { rows.push(mu.match); byId.set(mu.match.id, mu.match) }
  }

  // Settle generation-time byes exactly as the generate route does.
  for (const u of computeByeAdvancements(rows, 'winners_bracket')) {
    const m = byId.get(u.matchId)
    if (m) for (const [k, v] of Object.entries(u.set)) (m as Record<string, unknown>)[k] = v
  }

  let guard = 0
  while (guard++ < 5000) {
    const ready = rows.find(m => m.status !== 'completed' && m.team_1_registration_id && m.team_2_registration_id)
    if (!ready) break
    const winner = pick(ready)
    const loser = winner === ready.team_1_registration_id ? ready.team_2_registration_id! : ready.team_1_registration_id!
    ready.winner_registration_id = winner
    ready.status = 'completed'
    losses[loser] = (losses[loser] ?? 0) + 1
    for (const mu of resolveCompletion(ready, rows)) apply(mu)
  }

  const realIncomplete = rows.filter(m => m.status !== 'completed' && m.team_1_registration_id && m.team_2_registration_id)
  const lossOf = (t: string) => losses[t] ?? 0
  return {
    realIncomplete,
    hung: guard >= 5000,
    zeroLoss: teams.filter(t => lossOf(t) === 0).length,
    oneLoss: teams.filter(t => lossOf(t) === 1).length,
    twoPlusLoss: teams.filter(t => lossOf(t) >= 2).length,
    overTwo: teams.filter(t => lossOf(t) > 2).length,
    champion: teams.find(t => lossOf(t) < 2) ?? null,
  }
}

const team1Wins: WinnerPick = m => m.team_1_registration_id!

describe('double elimination — every field size resolves cleanly', () => {
  const sizes = Array.from({ length: 29 }, (_, i) => i + 4) // 4..32
  for (const n of sizes) {
    it(`N=${n}: single champion, everyone else eliminated at exactly two losses`, () => {
      const r = simulate(n, team1Wins)
      expect(r.hung).toBe(false)
      expect(r.realIncomplete.map(m => `${m.match_stage} r${m.round_number} #${m.match_number}`)).toEqual([])
      expect(r.overTwo).toBe(0)        // nobody plays on after their second loss
      expect(r.zeroLoss + r.oneLoss).toBe(1) // exactly one survivor (the champion)
      expect(r.twoPlusLoss).toBe(n - 1)
    })
  }
})

describe('phantomMatchIds — fresh bracket, no real match is hidden', () => {
  it('8-team double elim: nothing is phantom (both losers-bracket round-2 matches stay)', () => {
    const rows = buildRows(8)
    const lb = rows.filter(m => m.match_stage === 'losers_bracket')
    expect(lb.length).toBe(6)                                   // 2 + 2 + 1 + 1
    expect(lb.filter(m => m.round_number === 2).length).toBe(2) // the round that was getting clipped
    // No byes at a power-of-two size → no padded slots → nothing to hide.
    expect(phantomMatchIds(rows).size).toBe(0)
  })

  it('non-power-of-2 (5 teams): hides only padded slots, never a match with a real team', () => {
    const rows = buildRows(5)
    const phantoms = phantomMatchIds(rows)
    const elim = rows.filter(m => m.match_stage === 'winners_bracket' || m.match_stage === 'losers_bracket')
    expect(phantoms.size).toBeGreaterThan(0)        // padding exists
    expect(phantoms.size).toBeLessThan(elim.length) // but the bracket isn't wiped out
    for (const m of rows) {
      if (m.team_1_registration_id || m.team_2_registration_id) expect(phantoms.has(m.id)).toBe(false)
    }
  })
})

describe('double elimination — bracket reset (LB champion wins the first final)', () => {
  // Force the losers-bracket champion to win the first championship so the
  // if-necessary decider (round 2) must be created and played. team_1 wins
  // everything except the first championship match.
  let firstChampSeen = false
  const lbChampTakesFinal: WinnerPick = m => {
    if (m.match_stage === 'championship' && (m.round_number ?? 1) === 1 && !firstChampSeen) {
      firstChampSeen = true
      return m.team_2_registration_id! // LB champ wins → reset
    }
    return m.team_1_registration_id!
  }

  for (const n of [4, 6, 8, 16, 19]) {
    it(`N=${n}: reset is created, played, and still yields a single champion`, () => {
      firstChampSeen = false
      const r = simulate(n, lbChampTakesFinal)
      expect(r.hung).toBe(false)
      expect(r.realIncomplete).toEqual([])
      expect(r.overTwo).toBe(0)
      expect(r.zeroLoss + r.oneLoss).toBe(1)
      expect(r.twoPlusLoss).toBe(n - 1)
    })
  }
})
