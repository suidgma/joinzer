import { describe, it, expect } from 'vitest'
import { applyMutations, type LocalMatch } from '../applyMutations'
import { scoreLocally, settleByesLocally } from '../localAdvance'
import { singleEliminationBracket, doubleEliminationBracket } from '../../tournament/bracketBuilder'
import { resolveBracket, type Mutation } from '../../tournament/resolveCompletion'

// Build an elimination bracket and normalize to LocalMatch[] with stable ids.
function build(rows: Record<string, unknown>[]): LocalMatch[] {
  return rows.map((r, i) => ({
    id: `m${i}`,
    round_number: (r.round_number as number) ?? null,
    match_number: r.match_number as number,
    match_stage: r.match_stage as string,
    team_1_registration_id: (r.team_1_registration_id as string) ?? null,
    team_2_registration_id: (r.team_2_registration_id as string) ?? null,
    winner_registration_id: (r.winner_registration_id as string) ?? null,
    status: (r.status as string) ?? 'scheduled',
    team_1_score: null,
    team_2_score: null,
  }))
}

const single = (n: number) =>
  build(singleEliminationBracket(Array.from({ length: n }, (_, i) => `t${i}`), 'single_elimination', {}, 1, true).rows)
const double = (n: number) =>
  build(doubleEliminationBracket(Array.from({ length: n }, (_, i) => `t${i}`), {}, 1, true) as Record<string, unknown>[])

// Play a bracket to completion via scoreLocally — team_1 wins every match (11–0),
// exactly as the score route + resolver would, but entirely client-side.
function play(start: LocalMatch[]) {
  let rows = settleByesLocally(start) // advance generation-time byes first
  const losses: Record<string, number> = {}
  let guard = 0
  while (guard++ < 2000) {
    const ready = rows.find(m => m.status !== 'completed' && m.team_1_registration_id && m.team_2_registration_id)
    if (!ready) break
    losses[ready.team_2_registration_id!] = (losses[ready.team_2_registration_id!] ?? 0) + 1
    rows = scoreLocally(rows, ready.id, 11, 0)
  }
  return {
    rows,
    losses,
    hung: guard >= 2000,
    incomplete: rows.filter(m => m.status !== 'completed' && m.team_1_registration_id && m.team_2_registration_id),
  }
}

describe('applyMutations — array twin of the score route apply loop', () => {
  const base: LocalMatch[] = [
    { id: 'a', round_number: 1, match_number: 1, match_stage: 'single_elimination', team_1_registration_id: 'x', team_2_registration_id: null, status: 'scheduled' },
    { id: 'b', round_number: 2, match_number: 2, match_stage: 'single_elimination', team_1_registration_id: null, team_2_registration_id: null, status: 'scheduled' },
  ]
  it('set fills an empty slot only, never overwrites', () => {
    const out = applyMutations(base, [
      { kind: 'set', matchId: 'b', field: 'team_1_registration_id', value: 'x' },
      { kind: 'set', matchId: 'a', field: 'team_1_registration_id', value: 'ZZ' }, // a.t1 already 'x'
    ] as Mutation[])
    expect(out.find(m => m.id === 'b')!.team_1_registration_id).toBe('x')
    expect(out.find(m => m.id === 'a')!.team_1_registration_id).toBe('x') // unchanged
  })
  it('complete marks a winner but not twice', () => {
    const done = applyMutations(base, [{ kind: 'complete', matchId: 'a', winner: 'x' }] as Mutation[])
    expect(done.find(m => m.id === 'a')).toMatchObject({ status: 'completed', winner_registration_id: 'x' })
    const again = applyMutations(done, [{ kind: 'complete', matchId: 'a', winner: 'y' }] as Mutation[])
    expect(again.find(m => m.id === 'a')!.winner_registration_id).toBe('x') // not overwritten
  })
  it('insert appends a new match; inputs are not mutated', () => {
    const out = applyMutations(base, [{ kind: 'insert', match: { id: 'reset', round_number: 2, match_number: 9, match_stage: 'championship', team_1_registration_id: 'x', team_2_registration_id: 'y', status: 'scheduled' } }] as Mutation[])
    expect(out).toHaveLength(3)
    expect(base).toHaveLength(2) // original untouched
  })
})

describe('scoreLocally — single elimination advances locally', () => {
  it('4 teams: scoring a semifinal fills the final slot', () => {
    const rows = single(4)
    const semi = rows.find(m => m.round_number === 1)!
    const after = scoreLocally(rows, semi.id, 11, 6)
    // The winner of the semi is now sitting in the final (round 2).
    const finalRow = after.find(m => m.round_number === 2)!
    expect([finalRow.team_1_registration_id, finalRow.team_2_registration_id]).toContain(semi.team_1_registration_id)
  })

  for (const n of [2, 4, 8]) {
    it(`${n} teams: plays to a single champion, nothing left hanging`, () => {
      const r = play(single(n))
      expect(r.hung).toBe(false)
      expect(r.incomplete).toHaveLength(0)
      expect(r.rows.filter(m => m.round_number === Math.log2(n) && m.status === 'completed')).toHaveLength(1) // one final
    })
  }
})

describe('scoreLocally — double elimination advances locally (incl. byes)', () => {
  for (const n of [4, 6, 8]) {
    it(`${n} teams: single champion, everyone else out at two losses, nothing hung`, () => {
      const r = play(double(n))
      const teams = Array.from({ length: n }, (_, i) => `t${i}`)
      expect(r.hung).toBe(false)
      expect(r.incomplete).toHaveLength(0)
      expect(teams.filter(t => (r.losses[t] ?? 0) > 2)).toHaveLength(0)
      expect(teams.filter(t => (r.losses[t] ?? 0) >= 2)).toHaveLength(n - 1) // all but the champion
    })
  }
})

// Replay safety: the outbox may re-send a score on reconnect, and the server applies
// each PATCH with the same engine + `.is(field,null)` / `.neq(status,'completed')` guards.
// The engine itself must therefore be idempotent — re-applying the same result changes
// nothing — so client and server converge no matter how many times a score replays.
describe('scoreLocally — idempotent replay', () => {
  const fingerprint = (rs: LocalMatch[]) =>
    rs.map(r => `${r.id}:${r.team_1_registration_id}|${r.team_2_registration_id}|${r.winner_registration_id}|${r.status}`).sort()

  it('re-scoring a match with the same result changes nothing', () => {
    const rows = single(4)
    const semi = rows.find(m => m.round_number === 1)!
    const once = scoreLocally(rows, semi.id, 11, 6)
    const twice = scoreLocally(once, semi.id, 11, 6)
    expect(twice).toEqual(once) // no double advancement, no duplicate rows
  })

  for (const [label, start] of [['single-8', single(8)], ['double-6 (byes)', double(6)]] as const) {
    it(`${label}: replaying every score is a no-op (no double-advance, no dup reset)`, () => {
      const played = play(start).rows
      let replayed = played
      for (const m of played.filter(x => x.status === 'completed' && x.team_1_registration_id && x.team_2_registration_id)) {
        const s1 = m.winner_registration_id === m.team_1_registration_id ? 11 : 0
        replayed = scoreLocally(replayed, m.id, s1, s1 === 11 ? 0 : 11)
      }
      expect(fingerprint(replayed)).toEqual(fingerprint(played))
    })
  }

  it('the engine is stable after a full play (resolveBracket → no mutations)', () => {
    expect(resolveBracket(play(double(8)).rows)).toEqual([])
  })
})
