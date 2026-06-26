import { describe, it, expect } from 'vitest'
import { playoffBracket, type MatchRow } from '../bracketBuilder'
import { resolveCompletion } from '../resolveCompletion'
import { computeStandings, type StandingsMatchInput, type StandingsRegInput } from '../standings'

// Seeds 1..n as registration ids 's1'..'sn' (already ordered best→worst, the
// contract playoffBracket expects from the standings slice).
const seeds = (n: number): string[] => Array.from({ length: n }, (_, i) => `s${i + 1}`)

// Maps the builder's plain rows into MatchRow objects with stable ids, the shape
// the resolver and the score routes operate on.
function toRows(plain: Record<string, unknown>[]): MatchRow[] {
  return plain.map((r, i) => ({
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

/**
 * Plays a playoff bracket to completion using the REAL resolver (resolveCompletion),
 * applied exactly as the match-score route does. `pick(match)` decides the winning
 * side; default is team_1. Returns the final rows + the crowned champion.
 */
function play(
  rows: MatchRow[],
  pick: (m: MatchRow) => 't1' | 't2' = () => 't1',
): { rows: MatchRow[]; champion: string | null } {
  const byId = new Map(rows.map(r => [r.id, r]))
  const apply = (mut: ReturnType<typeof resolveCompletion>[number]) => {
    if (mut.kind === 'set') {
      const m = byId.get(mut.matchId)
      if (m && m[mut.field] == null) m[mut.field] = mut.value
    } else if (mut.kind === 'complete') {
      const m = byId.get(mut.matchId)
      if (m && m.status !== 'completed') { m.status = 'completed'; m.winner_registration_id = mut.winner }
    } else {
      const m = mut.match
      rows.push(m); byId.set(m.id, m)
    }
  }

  let guard = 0
  while (guard++ < 500) {
    const ready = rows.find(m => m.status !== 'completed' && m.team_1_registration_id && m.team_2_registration_id)
    if (!ready) break
    const winner = pick(ready) === 't1' ? ready.team_1_registration_id! : ready.team_2_registration_id!
    ready.status = 'completed'
    ready.winner_registration_id = winner
    for (const mut of resolveCompletion({ ...ready }, rows)) apply(mut)
  }

  // The champion is the winner of the last-played decisive match: a championship
  // final (double-elim final) or the single-elim final round.
  const champ = rows
    .filter(m => m.status === 'completed' && m.winner_registration_id)
    .sort((a, b) => (a.match_number ?? 0) - (b.match_number ?? 0))
  // Prefer a championship round-2 (reset) winner, else championship r1, else the
  // highest-round playoffs match.
  const champRows = rows.filter(m => m.match_stage === 'championship' && m.status === 'completed')
  if (champRows.length) {
    const last = champRows.sort((a, b) => (b.round_number ?? 0) - (a.round_number ?? 0))[0]
    return { rows, champion: last.winner_registration_id ?? null }
  }
  const playoffRows = rows.filter(m => m.match_stage === 'playoffs' && m.status === 'completed' && m.team_2_registration_id)
  const maxRound = Math.max(...playoffRows.map(m => m.round_number ?? 0))
  const final = playoffRows.find(m => (m.round_number ?? 0) === maxRound)
  return { rows, champion: final?.winner_registration_id ?? champ.at(-1)?.winner_registration_id ?? null }
}

describe('playoffBracket — single-elimination shape', () => {
  it('2 qualifiers → one playoffs match', () => {
    const { rows } = playoffBracket(seeds(2), 'single_elimination', {})
    expect(rows).toHaveLength(1)
    expect(rows[0].match_stage).toBe('playoffs')
    expect(rows[0].round_number).toBe(1)
    expect(rows[0].team_1_registration_id).toBe('s1')
    expect(rows[0].team_2_registration_id).toBe('s2')
  })

  it('4 qualifiers → 2 semis + final, top seed plays bottom seed', () => {
    const { rows } = playoffBracket(seeds(4), 'single_elimination', {})
    expect(rows).toHaveLength(3)
    expect(rows.every(r => r.match_stage === 'playoffs')).toBe(true)
    const r1 = rows.filter(r => r.round_number === 1)
    expect(r1).toHaveLength(2)
    // Standard seeding: (1 v 4) and (2 v 3) — no byes for a power-of-two field.
    expect(new Set([r1[0].team_1_registration_id, r1[0].team_2_registration_id])).toEqual(new Set(['s1', 's4']))
    expect(new Set([r1[1].team_1_registration_id, r1[1].team_2_registration_id])).toEqual(new Set(['s2', 's3']))
    expect(r1.every(m => m.status !== 'completed')).toBe(true) // real matches, not byes
  })

  it('8 qualifiers → 4 + 2 + 1 matches', () => {
    const { rows } = playoffBracket(seeds(8), 'single_elimination', {})
    expect(rows).toHaveLength(7)
    expect(rows.filter(r => r.round_number === 1)).toHaveLength(4)
    expect(rows.filter(r => r.round_number === 2)).toHaveLength(2)
    expect(rows.filter(r => r.round_number === 3)).toHaveLength(1)
  })

  it('6 qualifiers → 8-slot bracket with the top 2 seeds getting byes', () => {
    const { rows } = playoffBracket(seeds(6), 'single_elimination', {})
    const r1 = rows.filter(r => r.round_number === 1)
    expect(r1).toHaveLength(4)
    // Two byes (auto-completed, no team_2), won by the top two seeds.
    const byes = r1.filter(m => m.status === 'completed' && !m.team_2_registration_id)
    expect(byes).toHaveLength(2)
    expect(new Set(byes.map(m => m.winner_registration_id))).toEqual(new Set(['s1', 's2']))
  })
})

describe('playoffBracket — double-elim final shape', () => {
  it('2 qualifiers → a single championship match seeded directly (no playoffs round)', () => {
    const { rows } = playoffBracket(seeds(2), 'double_elimination', {})
    expect(rows).toHaveLength(1)
    expect(rows[0].match_stage).toBe('championship')
    expect(rows[0].round_number).toBe(1)
    expect(rows[0].team_1_registration_id).toBe('s1') // advantaged finalist
    expect(rows[0].team_2_registration_id).toBe('s2') // challenger (must win twice)
  })

  it('4 qualifiers → 2 playoffs semis + a championship final (no extra playoffs final)', () => {
    const { rows } = playoffBracket(seeds(4), 'double_elimination', {})
    const playoffs = rows.filter(r => r.match_stage === 'playoffs')
    const champ = rows.filter(r => r.match_stage === 'championship')
    expect(playoffs).toHaveLength(2)
    expect(playoffs.every(r => r.round_number === 1)).toBe(true)
    expect(champ).toHaveLength(1)
    expect(champ[0].round_number).toBe(1)
  })

  it('8 qualifiers → 4 QF + 2 SF playoffs + 1 championship', () => {
    const { rows } = playoffBracket(seeds(8), 'double_elimination', {})
    expect(rows.filter(r => r.match_stage === 'playoffs' && r.round_number === 1)).toHaveLength(4)
    expect(rows.filter(r => r.match_stage === 'playoffs' && r.round_number === 2)).toHaveLength(2)
    expect(rows.filter(r => r.match_stage === 'championship')).toHaveLength(1)
  })
})

describe('playoffBracket — full play-through (single elimination)', () => {
  for (const n of [2, 4, 6, 8]) {
    it(`N=${n}: resolves to a single champion with no hanging matches`, () => {
      const rows = toRows(playoffBracket(seeds(n), 'single_elimination', {}).rows)
      const { rows: done, champion } = play(rows, () => 't1')
      expect(done.filter(m => m.status !== 'completed')).toHaveLength(0)
      expect(champion).toBe('s1') // top seed wins every match → wins it all
    })
  }
})

describe('playoffBracket — double-elim final advancement + reset', () => {
  it('advantaged finalist winning the first final ends it — no reset created', () => {
    const rows = toRows(playoffBracket(seeds(4), 'double_elimination', {}).rows)
    // team_1 wins everywhere, including the championship → no decider needed.
    const { rows: done, champion } = play(rows, () => 't1')
    expect(done.filter(m => m.match_stage === 'championship')).toHaveLength(1) // no round-2 reset
    expect(done.every(m => m.status === 'completed')).toBe(true)
    expect(champion).toBe('s1')
  })

  it('challenger winning the first final forces an if-necessary decider (reset)', () => {
    const rows = toRows(playoffBracket(seeds(4), 'double_elimination', {}).rows)
    // Semis go to seeds (team_1 wins) so the championship is s1 (advantaged) vs s2
    // (challenger). The challenger wins the FIRST final, then the advantaged team
    // takes the reset — both finalists end with one playoff-stage loss.
    const { rows: done, champion } = play(rows, m =>
      m.match_stage === 'championship' && m.round_number === 1 ? 't2' : 't1',
    )
    const champs = done.filter(m => m.match_stage === 'championship')
    expect(champs).toHaveLength(2) // first final + the reset decider
    expect(champs.some(m => m.round_number === 2)).toBe(true)
    expect(done.every(m => m.status === 'completed')).toBe(true)
    expect(champion).toBe('s1') // advantaged finalist wins the decider
  })

  it('challenger winning BOTH finals is crowned without a third match', () => {
    const rows = toRows(playoffBracket(seeds(4), 'double_elimination', {}).rows)
    const { rows: done, champion } = play(rows, m =>
      m.match_stage === 'championship' ? 't2' : 't1',
    )
    expect(done.filter(m => m.match_stage === 'championship')).toHaveLength(2)
    expect(champion).toBe('s2') // challenger swept both finals
  })
})

describe('playoffBracket — seeding from round-robin standings', () => {
  // A 4-team round robin scored so the standings order is unambiguous:
  // A 3-0, B 2-1, C 1-2, D 0-3. The top-N slice must feed the bracket best-first.
  const teams = ['A', 'B', 'C', 'D']
  const regs: StandingsRegInput[] = teams.map(t => ({ id: t, status: 'registered', partner_registration_id: null }))
  const rr = (t1: string, t2: string, s1: number, s2: number): StandingsMatchInput => ({
    match_stage: 'round_robin', round_number: 1, status: 'completed',
    team_1_registration_id: t1, team_2_registration_id: t2,
    team_1_score: s1, team_2_score: s2, winner_registration_id: s1 > s2 ? t1 : t2,
  })
  const matches: StandingsMatchInput[] = [
    rr('A', 'B', 11, 7), rr('A', 'C', 11, 4), rr('A', 'D', 11, 2),
    rr('B', 'C', 11, 8), rr('B', 'D', 11, 5),
    rr('C', 'D', 11, 9),
  ]

  it('orders A > B > C > D and seeds the bracket in that order', () => {
    const standings = computeStandings(matches, regs)
    expect(standings.map(r => r.regId)).toEqual(['A', 'B', 'C', 'D'])

    const seeded = standings.slice(0, 4).map(s => s.regId)
    const { rows } = playoffBracket(seeded, 'single_elimination', {})
    const r1 = rows.filter(r => r.round_number === 1)
    // Top seed (A) vs bottom seed (D); B vs C.
    expect(new Set([r1[0].team_1_registration_id, r1[0].team_2_registration_id])).toEqual(new Set(['A', 'D']))
    expect(new Set([r1[1].team_1_registration_id, r1[1].team_2_registration_id])).toEqual(new Set(['B', 'C']))
  })

  it('a top-2 slice seeds only the two best finishers into a single final', () => {
    const standings = computeStandings(matches, regs)
    const seeded = standings.slice(0, 2).map(s => s.regId)
    const { rows } = playoffBracket(seeded, 'single_elimination', {})
    expect(rows).toHaveLength(1)
    expect(rows[0].team_1_registration_id).toBe('A')
    expect(rows[0].team_2_registration_id).toBe('B')
  })
})
