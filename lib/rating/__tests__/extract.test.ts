import { describe, it, expect } from 'vitest'
import { rrMatchesToGames, fixturesToGames, tournamentMatchesToGames } from '../extract'

describe('rrMatchesToGames', () => {
  const sessions = new Map([['s1', { session_date: '2026-01-01', league_id: 'lg1' }]])
  const fmt = new Map([['lg1', 'mens_doubles'], ['lg2', 'mens_singles']])

  it('builds a doubles game with 2 players per side', () => {
    const games = rrMatchesToGames([
      { id: 'm1', session_id: 's1', team1_player1_id: 'a', team1_player2_id: 'b', team2_player1_id: 'c', team2_player2_id: 'd', team1_score: 11, team2_score: 7 },
    ], sessions, fmt)
    expect(games).toHaveLength(1)
    expect(games[0]).toMatchObject({ format: 'doubles', sideA: ['a', 'b'], sideB: ['c', 'd'], winner: 'A', occasionId: 's1', competitionId: 'lg1' })
  })

  it('skips unknown sessions and ties', () => {
    expect(rrMatchesToGames([{ id: 'm', session_id: 'zzz', team1_player1_id: 'a', team2_player1_id: 'b', team1_score: 11, team2_score: 9 }], sessions, fmt)).toHaveLength(0)
    expect(rrMatchesToGames([{ id: 'm', session_id: 's1', team1_player1_id: 'a', team2_player1_id: 'b', team1_score: 11, team2_score: 11 }], sessions, fmt)).toHaveLength(0)
  })
})

describe('fixturesToGames', () => {
  const regs = new Map([
    ['rA', { user_id: 'a', partner_user_id: 'b' }],
    ['rC', { user_id: 'c', partner_user_id: 'd' }],
  ])
  const fmt = new Map([['lg1', 'mixed_doubles']])

  it('resolves doubles partners and honors winner_registration_id', () => {
    const games = fixturesToGames([
      { id: 'f1', league_id: 'lg1', period_id: 'p1', team_1_registration_id: 'rA', team_2_registration_id: 'rC', team_1_score: 9, team_2_score: 11, winner_registration_id: 'rC', status: 'completed', match_stage: 'round_robin', updated_at: '2026-02-01' },
    ], regs, fmt)
    expect(games[0]).toMatchObject({ format: 'doubles', sideA: ['a', 'b'], sideB: ['c', 'd'], winner: 'B', occasionId: 'p1' })
  })

  it('excludes ladder byes and non-completed fixtures', () => {
    expect(fixturesToGames([{ id: 'f', league_id: 'lg1', period_id: 'p', team_1_registration_id: 'rA', team_2_registration_id: 'rC', team_1_score: 11, team_2_score: 2, status: 'completed', match_stage: 'ladder_bye', updated_at: 'x' }], regs, fmt)).toHaveLength(0)
    expect(fixturesToGames([{ id: 'f', league_id: 'lg1', period_id: 'p', team_1_registration_id: 'rA', team_2_registration_id: 'rC', team_1_score: null, team_2_score: null, status: 'scheduled', match_stage: 'round_robin', updated_at: 'x' }], regs, fmt)).toHaveLength(0)
  })
})

describe('tournamentMatchesToGames', () => {
  const regs = new Map([
    ['r1', { user_id: 'a', partner_user_id: 'b' }],
    ['r2', { user_id: 'c', partner_user_id: 'd' }],
    ['r3', { user_id: 'e', partner_user_id: null }],
    ['r4', { user_id: 'f', partner_user_id: null }],
    ['r5', { user_id: 'g', partner_user_id: null }],
    ['r6', { user_id: 'h', partner_user_id: null }],
  ])
  const divsDoubles = new Map([['d1', { team_type: 'doubles', category: 'mens_doubles' }]])
  const divsRotating = new Map([['d2', { team_type: 'doubles', category: 'open' }]])
  const divsSingles = new Map([['d3', { team_type: 'singles', category: 'singles' }]])
  const base = { tournament_id: 'T', division_id: 'd1', team_1_registration_id: 'r1', team_2_registration_id: 'r2', team_1_score: 11, team_2_score: 5, winner_registration_id: 'r1', status: 'completed', is_draft: false, team_1_source: null, team_2_source: null, scheduled_time: '2026-03-01' }

  it('fixed doubles resolves partner_user_id', () => {
    const gm = tournamentMatchesToGames([{ ...base, id: 't1' }], regs, divsDoubles)
    expect(gm[0]).toMatchObject({ format: 'doubles', sideA: ['a', 'b'], sideB: ['c', 'd'], winner: 'A', occasionId: 'T' })
  })

  it('rotating doubles resolves the four registration ids', () => {
    const gm = tournamentMatchesToGames([{
      ...base, id: 't2', division_id: 'd2', team_1_registration_id: 'r3', team_1_partner_registration_id: 'r4', team_2_registration_id: 'r5', team_2_partner_registration_id: 'r6', winner_registration_id: 'r3',
    }], regs, divsRotating)
    expect(gm[0]).toMatchObject({ sideA: ['e', 'f'], sideB: ['g', 'h'], winner: 'A' })
  })

  it('singles = one user per side', () => {
    const gm = tournamentMatchesToGames([{ ...base, id: 't3', division_id: 'd3', team_1_registration_id: 'r3', team_2_registration_id: 'r5', winner_registration_id: 'r3' }], regs, divsSingles)
    expect(gm[0]).toMatchObject({ format: 'singles', sideA: ['e'], sideB: ['g'] })
  })

  it('excludes drafts, placeholders, and non-completed', () => {
    expect(tournamentMatchesToGames([{ ...base, id: 'a', is_draft: true }], regs, divsDoubles)).toHaveLength(0)
    expect(tournamentMatchesToGames([{ ...base, id: 'b', team_1_source: { kind: 'rank' } }], regs, divsDoubles)).toHaveLength(0)
    expect(tournamentMatchesToGames([{ ...base, id: 'c', status: 'scheduled' }], regs, divsDoubles)).toHaveLength(0)
  })
})
