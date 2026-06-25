import { describe, it, expect } from 'vitest'
import { computeStandings, type StandingsMatchInput, type StandingsRegInput } from '../standings'

// Reconstructs the in-progress 8-player double-elimination from the test division
// (Abraham/Byron undefeated in the winners bracket; Callum/Fletcher/Damian/Gregory
// at one loss; Harvey/Emmett eliminated at two). Pins the spine of elimination
// standings: fewest losses ranks highest, so an undefeated winners-bracket team
// must sit above a one-loss losers-bracket team. The old stage-rank sort got this
// backwards (losers_bracket outranks winners_bracket) and floated 1-1 LB players
// to the top.

const P = ['Abraham', 'Byron', 'Callum', 'Damian', 'Emmett', 'Fletcher', 'Gregory', 'Harvey']
const regs: StandingsRegInput[] = P.map(p => ({ id: p, status: 'registered', partner_registration_id: null }))

const m = (
  stage: string, round: number, t1: string, t2: string, s1: number, s2: number,
): StandingsMatchInput => ({
  match_stage: stage, round_number: round, status: 'completed',
  team_1_registration_id: t1, team_2_registration_id: t2,
  team_1_score: s1, team_2_score: s2,
  winner_registration_id: s1 > s2 ? t1 : t2,
})

const matches: StandingsMatchInput[] = [
  // Winners bracket R1
  m('winners_bracket', 1, 'Fletcher', 'Abraham', 5, 11),
  m('winners_bracket', 1, 'Emmett', 'Damian', 6, 11),
  m('winners_bracket', 1, 'Callum', 'Gregory', 7, 11),
  m('winners_bracket', 1, 'Harvey', 'Byron', 8, 11),
  // Winners bracket R2 (semis)
  m('winners_bracket', 2, 'Abraham', 'Damian', 11, 5),
  m('winners_bracket', 2, 'Gregory', 'Byron', 4, 11),
  // Losers bracket R1
  m('losers_bracket', 1, 'Fletcher', 'Emmett', 11, 3),
  m('losers_bracket', 1, 'Callum', 'Harvey', 11, 5),
  // WB final + LB R2 not yet played
]

describe('computeStandings — double elimination ordering', () => {
  const rows = computeStandings(matches, regs)

  it('ranks fewest-losses first (undefeated WB above one-loss LB above eliminated)', () => {
    for (let i = 0; i < rows.length - 1; i++) {
      expect(rows[i].losses).toBeLessThanOrEqual(rows[i + 1].losses)
    }
  })

  it('puts the two undefeated winners-bracket teams on top', () => {
    expect(new Set([rows[0].regId, rows[1].regId])).toEqual(new Set(['Abraham', 'Byron']))
    expect(rows[0].losses).toBe(0)
    expect(rows[1].losses).toBe(0)
  })

  it('puts the two eliminated teams at the bottom', () => {
    const last2 = new Set([rows[6].regId, rows[7].regId])
    expect(last2).toEqual(new Set(['Harvey', 'Emmett']))
    expect(rows[6].losses).toBe(2)
    expect(rows[7].losses).toBe(2)
  })
})
