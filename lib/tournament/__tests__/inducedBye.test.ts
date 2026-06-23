import { describe, it, expect } from 'vitest'
import { checkPendingFeeder, matchWillBeReal, type MatchRow } from '../bracketBuilder'

// Regression for the "final wins without a score" bug: scoring one half of a
// single-elim bracket down to a match must NOT auto-complete it as an induced
// BYE while the other feeder is still resolving (its own upstream matches unscored).

const STAGE = 'single_elimination'
function m(
  id: string, round: number, num: number,
  t1: string | null, t2: string | null,
  opts: { winner?: string; status?: string } = {},
): MatchRow {
  return {
    id, round_number: round, match_number: num, match_stage: STAGE,
    team_1_registration_id: t1, team_2_registration_id: t2,
    winner_registration_id: opts.winner ?? null, status: opts.status ?? 'scheduled',
  }
}

// 8-team single elim: R1 quarters q1..q4, R2 semis s1/s2, R3 final f1.
// Top half fully scored (s1 done, winner A in final.team_1); bottom half not yet
// played — q3/q4 have real players but aren't scored, so s2 is still null-null.
function topHalfScored(): MatchRow[] {
  return [
    m('q1', 1, 1, 'A', 'B', { winner: 'A', status: 'completed' }),
    m('q2', 1, 2, 'C', 'D', { winner: 'C', status: 'completed' }),
    m('q3', 1, 3, 'E', 'F'),
    m('q4', 1, 4, 'G', 'H'),
    m('s1', 2, 5, 'A', 'C', { winner: 'A', status: 'completed' }),
    m('s2', 2, 6, null, null),                 // waiting on q3 + q4
    m('f1', 3, 7, 'A', null),                   // top semi winner advanced here
  ]
}

describe('checkPendingFeeder — single elimination', () => {
  it('treats a still-empty sibling semifinal as a pending feeder (no induced BYE)', () => {
    const all = topHalfScored()
    const s1 = all.find(x => x.id === 's1')!
    const result = checkPendingFeeder(
      { id: 'f1', match_stage: STAGE, round_number: 3 },
      'team_2_registration_id',
      s1,
      all,
    )
    expect(result).toBe(true)   // final must WAIT for the second semifinal
  })

  it('still reports a genuine induced BYE when the sibling feeder is a phantom', () => {
    // q3/q4 are padded phantom slots (null-null, round 1) that will never have
    // players, so s2 will never be real → the final IS an induced bye.
    const all: MatchRow[] = [
      m('q1', 1, 1, 'A', 'B', { winner: 'A', status: 'completed' }),
      m('q2', 1, 2, 'C', 'D', { winner: 'C', status: 'completed' }),
      m('q3', 1, 3, null, null),
      m('q4', 1, 4, null, null),
      m('s1', 2, 5, 'A', 'C', { winner: 'A', status: 'completed' }),
      m('s2', 2, 6, null, null),
      m('f1', 3, 7, 'A', null),
    ]
    const s1 = all.find(x => x.id === 's1')!
    const result = checkPendingFeeder(
      { id: 'f1', match_stage: STAGE, round_number: 3 },
      'team_2_registration_id',
      s1,
      all,
    )
    expect(result).toBe(false)
  })
})

describe('matchWillBeReal', () => {
  it('is true for a null-null match whose upstream feeders have real players', () => {
    const all = topHalfScored()
    expect(matchWillBeReal(all.find(x => x.id === 's2')!, all)).toBe(true)
  })

  it('is false for a null-null match fed only by phantom slots', () => {
    const all: MatchRow[] = [
      m('q3', 1, 3, null, null),
      m('q4', 1, 4, null, null),
      m('s2', 2, 6, null, null),
    ]
    expect(matchWillBeReal(all.find(x => x.id === 's2')!, all)).toBe(false)
  })
})
