import { describe, it, expect } from 'vitest'
import { computeStandings, type StandingsMatchInput, type StandingsRegInput } from '../standings'

// Reconstructs the in-progress 8-player double-elimination from the test division
// (Abraham/Byron undefeated in the winners bracket; Callum/Fletcher/Damian/Gregory
// at one loss; Harvey/Emmett eliminated at two). Standings rank by win% then +/-,
// so the undefeated (100%) teams sit on top and the eliminated (0%) teams at the
// bottom, with point differential ordering the equal-record teams in between.

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

describe('computeStandings — point-differential tiebreak', () => {
  // 4-player double elim mirroring the reported case: Abel 2-0, Byron & Caleb both
  // 1-1, Dante 0-2. Byron and Caleb share a record, so +/- decides — Caleb (+4)
  // must rank above Byron (-4).
  const four = ['Abel', 'Byron', 'Caleb', 'Dante']
  const fourRegs: StandingsRegInput[] = four.map(p => ({ id: p, status: 'registered', partner_registration_id: null }))
  const fourMatches: StandingsMatchInput[] = [
    m('winners_bracket', 1, 'Abel', 'Dante', 11, 2),   // Abel +9, Dante -9
    m('winners_bracket', 1, 'Byron', 'Caleb', 11, 9),  // Byron +2, Caleb -2
    m('winners_bracket', 2, 'Abel', 'Byron', 11, 5),   // Abel +6, Byron -6 → Byron net -4
    m('losers_bracket', 1, 'Caleb', 'Dante', 11, 5),   // Caleb +6 → Caleb net +4, Dante -15
  ]

  it('orders equal-record teams by +/- (Caleb +4 above Byron -4)', () => {
    const rows = computeStandings(fourMatches, fourRegs)
    expect(rows.map(r => r.regId)).toEqual(['Abel', 'Caleb', 'Byron', 'Dante'])
  })
})
