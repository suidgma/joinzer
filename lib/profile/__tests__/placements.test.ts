import { describe, it, expect } from 'vitest'
import { computePlacements, type PlacementMatch, type PlacementReg } from '../placements'

// Terse match builder.
const m = (o: Partial<PlacementMatch> & { match_stage: string; round_number: number }): PlacementMatch => ({
  status: 'completed',
  team_1_registration_id: null,
  team_2_registration_id: null,
  team_1_score: null,
  team_2_score: null,
  winner_registration_id: null,
  match_number: 1,
  ...o,
})
const reg = (id: string): PlacementReg => ({ id, status: 'registered', partner_registration_id: null })
const placeOf = (ps: ReturnType<typeof computePlacements>, id: string) => ps.find((p) => p.registrationId === id)?.place

describe('computePlacements — single elimination', () => {
  // 4-team: two semis (round 1) + final (round 2).
  const semis = [
    m({ match_stage: 'single_elimination', round_number: 1, team_1_registration_id: 'A', team_2_registration_id: 'D', winner_registration_id: 'A' }),
    m({ match_stage: 'single_elimination', round_number: 1, team_1_registration_id: 'B', team_2_registration_id: 'C', winner_registration_id: 'B' }),
  ]
  it('champion, finalist, and both semifinalists at 3rd', () => {
    const ps = computePlacements('single_elimination', [
      ...semis,
      m({ match_stage: 'single_elimination', round_number: 2, team_1_registration_id: 'A', team_2_registration_id: 'B', winner_registration_id: 'A' }),
    ], ['A', 'B', 'C', 'D'].map(reg))
    expect(placeOf(ps, 'A')).toBe(1)
    expect(placeOf(ps, 'B')).toBe(2)
    expect(placeOf(ps, 'C')).toBe(3)
    expect(placeOf(ps, 'D')).toBe(3)
  })

  it('returns nothing until the final is completed', () => {
    const ps = computePlacements('single_elimination', [
      ...semis,
      m({ match_stage: 'single_elimination', round_number: 2, status: 'scheduled', team_1_registration_id: 'A', team_2_registration_id: 'B' }),
    ], ['A', 'B', 'C', 'D'].map(reg))
    expect(ps).toEqual([])
  })

  it('2-team bracket: champion + finalist, no 3rd', () => {
    const ps = computePlacements('single_elimination', [
      m({ match_stage: 'single_elimination', round_number: 1, team_1_registration_id: 'A', team_2_registration_id: 'B', winner_registration_id: 'A' }),
    ], ['A', 'B'].map(reg))
    expect(ps).toEqual([{ registrationId: 'A', place: 1 }, { registrationId: 'B', place: 2 }])
  })
})

describe('computePlacements — double elimination', () => {
  const wbAndLb = [
    m({ match_stage: 'losers_bracket', round_number: 1, team_1_registration_id: 'C', team_2_registration_id: 'D', winner_registration_id: 'C' }),
    m({ match_stage: 'losers_bracket', round_number: 2, team_1_registration_id: 'B', team_2_registration_id: 'C', winner_registration_id: 'B' }), // LB final, C is 3rd
  ]
  it('no reset: WB champ (team_1) wins championship round 1', () => {
    const ps = computePlacements('double_elimination', [
      ...wbAndLb,
      m({ match_stage: 'championship', round_number: 1, team_1_registration_id: 'A', team_2_registration_id: 'B', winner_registration_id: 'A' }),
    ], ['A', 'B', 'C', 'D'].map(reg))
    expect(placeOf(ps, 'A')).toBe(1)
    expect(placeOf(ps, 'B')).toBe(2)
    expect(placeOf(ps, 'C')).toBe(3)
  })

  it('reset: LB champ (team_2) wins round 1, round 2 decides', () => {
    const base = [
      ...wbAndLb,
      m({ match_stage: 'championship', round_number: 1, team_1_registration_id: 'A', team_2_registration_id: 'B', winner_registration_id: 'B' }),
    ]
    // reset pending → no placement yet
    expect(computePlacements('double_elimination', base, ['A', 'B', 'C', 'D'].map(reg))).toEqual([])
    // round 2 played → B champion, A finalist
    const ps = computePlacements('double_elimination', [
      ...base,
      m({ match_stage: 'championship', round_number: 2, team_1_registration_id: 'A', team_2_registration_id: 'B', winner_registration_id: 'B' }),
    ], ['A', 'B', 'C', 'D'].map(reg))
    expect(placeOf(ps, 'B')).toBe(1)
    expect(placeOf(ps, 'A')).toBe(2)
    expect(placeOf(ps, 'C')).toBe(3)
  })
})

describe('computePlacements — round robin', () => {
  it('ranks top 3 by standings once every match is complete', () => {
    // A beats B & C; B beats C. A 2-0, B 1-1, C 0-2.
    const ps = computePlacements('round_robin', [
      m({ match_stage: 'round_robin', round_number: 1, team_1_registration_id: 'A', team_2_registration_id: 'B', team_1_score: 11, team_2_score: 4, winner_registration_id: 'A' }),
      m({ match_stage: 'round_robin', round_number: 2, team_1_registration_id: 'A', team_2_registration_id: 'C', team_1_score: 11, team_2_score: 6, winner_registration_id: 'A' }),
      m({ match_stage: 'round_robin', round_number: 3, team_1_registration_id: 'B', team_2_registration_id: 'C', team_1_score: 11, team_2_score: 9, winner_registration_id: 'B' }),
    ], ['A', 'B', 'C'].map(reg))
    expect(ps).toEqual([
      { registrationId: 'A', place: 1 },
      { registrationId: 'B', place: 2 },
      { registrationId: 'C', place: 3 },
    ])
  })

  it('returns nothing while any match is unplayed', () => {
    const ps = computePlacements('round_robin', [
      m({ match_stage: 'round_robin', round_number: 1, team_1_registration_id: 'A', team_2_registration_id: 'B', winner_registration_id: 'A' }),
      m({ match_stage: 'round_robin', round_number: 2, status: 'scheduled', team_1_registration_id: 'A', team_2_registration_id: 'C' }),
    ], ['A', 'B', 'C'].map(reg))
    expect(ps).toEqual([])
  })
})

describe('computePlacements — pool play → playoffs', () => {
  it('uses the playoff bracket final, not the pools', () => {
    const ps = computePlacements('pool_play_playoffs', [
      m({ match_stage: 'pool_play', round_number: 1, pool_number: 1, team_1_registration_id: 'A', team_2_registration_id: 'B', winner_registration_id: 'A' } as any),
      m({ match_stage: 'playoffs', round_number: 1, team_1_registration_id: 'A', team_2_registration_id: 'C', winner_registration_id: 'A' }),
      m({ match_stage: 'playoffs', round_number: 1, team_1_registration_id: 'B', team_2_registration_id: 'D', winner_registration_id: 'B' }),
      m({ match_stage: 'playoffs', round_number: 2, team_1_registration_id: 'A', team_2_registration_id: 'B', winner_registration_id: 'B' }),
    ], ['A', 'B', 'C', 'D'].map(reg))
    expect(placeOf(ps, 'B')).toBe(1)
    expect(placeOf(ps, 'A')).toBe(2)
    expect(placeOf(ps, 'C')).toBe(3)
    expect(placeOf(ps, 'D')).toBe(3)
  })

  it('no placement while still in pool play', () => {
    const ps = computePlacements('pool_play_playoffs', [
      m({ match_stage: 'pool_play', round_number: 1, team_1_registration_id: 'A', team_2_registration_id: 'B', winner_registration_id: 'A' }),
    ], ['A', 'B'].map(reg))
    expect(ps).toEqual([])
  })
})

describe('computePlacements — guards', () => {
  it('empty / unknown', () => {
    expect(computePlacements('single_elimination', [], [reg('A')])).toEqual([])
    expect(computePlacements('mystery', [], [])).toEqual([])
  })
})
