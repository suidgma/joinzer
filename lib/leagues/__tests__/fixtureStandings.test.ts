import { describe, it, expect } from 'vitest'
import { computeFixtureStandings } from '../fixtureStandings'
import type { LeagueFixture } from '../../types'

const reg = (id: string) => ({ id, status: 'registered', partner_registration_id: null })

function fx(partial: Partial<LeagueFixture>): LeagueFixture {
  return {
    id: 'f', league_id: 'L', period_id: null, box_id: null,
    round_number: 1, match_number: 1, match_stage: 'round_robin',
    team_1_registration_id: null, team_2_registration_id: null,
    team_1_score: null, team_2_score: null, winner_registration_id: null,
    status: 'scheduled', court_number: null, scheduled_time: null,
    window_start: null, window_end: null, reported_by: null, confirmed_by: null,
    parent_fixture_id: null, created_at: '', updated_at: '',
    ...partial,
  }
}

// A completed fixture between two registrations; winner derived from the scores.
function played(id: string, t1: string, t2: string, s1: number, s2: number, box = 'box1'): LeagueFixture {
  return fx({
    id, box_id: box, status: 'completed',
    team_1_registration_id: t1, team_2_registration_id: t2,
    team_1_score: s1, team_2_score: s2,
    winner_registration_id: s1 > s2 ? t1 : t2,
  })
}

describe('computeFixtureStandings', () => {
  const regs = [reg('A'), reg('B'), reg('C')]

  it('ranks a round-robin box by win% then differential', () => {
    const fixtures = [
      played('1', 'A', 'B', 11, 5),
      played('2', 'A', 'C', 11, 7),
      played('3', 'B', 'C', 11, 9),
    ]
    const rows = computeFixtureStandings(fixtures, regs, { boxId: 'box1' })
    expect(rows.map(r => r.regId)).toEqual(['A', 'B', 'C'])
    expect(rows.find(r => r.regId === 'A')).toMatchObject({ wins: 2, losses: 0, pf: 22 })
    expect(rows.find(r => r.regId === 'B')).toMatchObject({ wins: 1, losses: 1 })
    expect(rows.find(r => r.regId === 'C')).toMatchObject({ wins: 0, losses: 2 })
  })

  it('scopes to a single box and ignores fixtures in other boxes', () => {
    const fixtures = [
      played('1', 'A', 'B', 11, 5),          // box1
      played('2', 'A', 'C', 11, 7),          // box1
      played('3', 'B', 'C', 11, 9),          // box1
      played('4', 'B', 'A', 11, 2, 'box2'),  // box2 — must not affect box1
    ]
    const box1 = computeFixtureStandings(fixtures, regs, { boxId: 'box1' })
    expect(box1.find(r => r.regId === 'A')).toMatchObject({ wins: 2, losses: 0 })

    const box2 = computeFixtureStandings(fixtures, regs, { boxId: 'box2' })
    expect(box2.find(r => r.regId === 'B')).toMatchObject({ wins: 1, losses: 0 })
    expect(box2.find(r => r.regId === 'A')).toMatchObject({ wins: 0, losses: 1 })
  })

  it('ignores non-completed fixtures', () => {
    const fixtures = [
      played('1', 'A', 'B', 11, 5),
      fx({ id: '2', box_id: 'box1', team_1_registration_id: 'A', team_2_registration_id: 'C', status: 'scheduled' }),
    ]
    const rows = computeFixtureStandings(fixtures, regs, { boxId: 'box1' })
    expect(rows.find(r => r.regId === 'A')).toMatchObject({ wins: 1, losses: 0 })
    expect(rows.find(r => r.regId === 'C')).toMatchObject({ wins: 0, losses: 0 })
  })
})
