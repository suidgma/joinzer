import { describe, it, expect } from 'vitest'
import { computePlayerStats } from '../stats'
import type { GameRecord } from '../types'

// Terse GameRecord builder. Player under test is 'me'.
const g = (o: Partial<GameRecord> & { id: string }): GameRecord => ({
  id: o.id,
  playedAt: o.playedAt ?? '2026-01-01T00:00:00Z',
  activity: 'pickleball',
  format: o.format ?? 'doubles',
  source: o.source ?? 'league',
  competitionId: o.competitionId ?? 'c1',
  occasionId: o.occasionId ?? 'o1',
  sideA: o.sideA ?? ['me'],
  sideB: o.sideB ?? ['opp'],
  winner: o.winner ?? 'A',
})

describe('computePlayerStats', () => {
  it('empty input → zeros, null streak, empty form', () => {
    const s = computePlayerStats([], 'me')
    expect(s).toMatchObject({ matches: 0, wins: 0, losses: 0, winPct: 0, currentStreak: null, recentForm: [], leaguesPlayed: 0, tournamentsPlayed: 0, eventsPlayed: 0 })
    expect(s.recentRecord).toEqual({ wins: 0, losses: 0 })
  })

  it('ignores matches the player is not in', () => {
    const s = computePlayerStats([g({ id: '1', sideA: ['x'], sideB: ['y'] })], 'me')
    expect(s.matches).toBe(0)
  })

  it('counts wins/losses and win% (player on side A)', () => {
    const s = computePlayerStats([
      g({ id: '1', winner: 'A' }), // W
      g({ id: '2', winner: 'A' }), // W
      g({ id: '3', winner: 'B' }), // L
    ], 'me')
    expect(s).toMatchObject({ matches: 3, wins: 2, losses: 1 })
    expect(s.winPct).toBeCloseTo(2 / 3, 5)
  })

  it('detects a win when the player is on side B', () => {
    const s = computePlayerStats([g({ id: '1', sideA: ['opp'], sideB: ['me'], winner: 'B' })], 'me')
    expect(s).toMatchObject({ matches: 1, wins: 1, losses: 0 })
  })

  it('credits both doubles partners (player is the partner on a side)', () => {
    const s = computePlayerStats([g({ id: '1', sideA: ['pardner', 'me'], sideB: ['a', 'b'], winner: 'A' })], 'me')
    expect(s.wins).toBe(1)
  })

  it('current streak = the run ending at the most recent match', () => {
    // chronological: L, W, W  → current streak W×2
    const s = computePlayerStats([
      g({ id: '1', playedAt: '2026-01-01T00:00:00Z', winner: 'B' }),
      g({ id: '2', playedAt: '2026-01-02T00:00:00Z', winner: 'A' }),
      g({ id: '3', playedAt: '2026-01-03T00:00:00Z', winner: 'A' }),
    ], 'me')
    expect(s.currentStreak).toEqual({ type: 'W', count: 2 })
  })

  it('losing streak + single-match + alternating', () => {
    const loseRun = computePlayerStats([
      g({ id: '1', playedAt: '2026-01-01T00:00:00Z', winner: 'A' }),
      g({ id: '2', playedAt: '2026-01-02T00:00:00Z', winner: 'B' }),
      g({ id: '3', playedAt: '2026-01-03T00:00:00Z', winner: 'B' }),
    ], 'me')
    expect(loseRun.currentStreak).toEqual({ type: 'L', count: 2 })

    const single = computePlayerStats([g({ id: '1', winner: 'A' })], 'me')
    expect(single.currentStreak).toEqual({ type: 'W', count: 1 })

    const alt = computePlayerStats([
      g({ id: '1', playedAt: '2026-01-01T00:00:00Z', winner: 'A' }),
      g({ id: '2', playedAt: '2026-01-02T00:00:00Z', winner: 'B' }),
    ], 'me')
    expect(alt.currentStreak).toEqual({ type: 'L', count: 1 })
  })

  it('sorts by playedAt regardless of input order (streak respects chronology)', () => {
    const s = computePlayerStats([
      g({ id: '3', playedAt: '2026-01-03T00:00:00Z', winner: 'A' }), // newest = W
      g({ id: '1', playedAt: '2026-01-01T00:00:00Z', winner: 'B' }),
      g({ id: '2', playedAt: '2026-01-02T00:00:00Z', winner: 'A' }),
    ], 'me')
    expect(s.currentStreak).toEqual({ type: 'W', count: 2 })
  })

  it('recent form = last 10 in chronological order, with its own record', () => {
    // 12 matches: first 2 losses (older), then 10 wins → window is the 10 wins.
    const recs: GameRecord[] = []
    for (let i = 0; i < 12; i++) {
      const day = String(i + 1).padStart(2, '0')
      recs.push(g({ id: `${i}`, playedAt: `2026-02-${day}T00:00:00Z`, winner: i < 2 ? 'B' : 'A' }))
    }
    const s = computePlayerStats(recs, 'me')
    expect(s.matches).toBe(12)
    expect(s.recentForm).toHaveLength(10)
    expect(s.recentForm.every((r) => r === 'W')).toBe(true) // the 2 early losses fall outside the window
    expect(s.recentRecord).toEqual({ wins: 10, losses: 0 })
  })

  it('format split (doubles vs singles)', () => {
    const s = computePlayerStats([
      g({ id: '1', format: 'doubles', winner: 'A' }),
      g({ id: '2', format: 'doubles', winner: 'B' }),
      g({ id: '3', format: 'singles', winner: 'A' }),
    ], 'me')
    expect(s.byFormat.doubles).toEqual({ matches: 2, wins: 1, losses: 1 })
    expect(s.byFormat.singles).toEqual({ matches: 1, wins: 1, losses: 0 })
  })

  it('distinct competitions across leagues + tournaments', () => {
    const s = computePlayerStats([
      g({ id: '1', source: 'league', competitionId: 'L1', winner: 'A' }),
      g({ id: '2', source: 'league', competitionId: 'L1', winner: 'A' }), // same league
      g({ id: '3', source: 'league', competitionId: 'L2', winner: 'B' }),
      g({ id: '4', source: 'tournament', competitionId: 'T1', winner: 'A' }),
    ], 'me')
    expect(s.leaguesPlayed).toBe(2)
    expect(s.tournamentsPlayed).toBe(1)
    expect(s.eventsPlayed).toBe(3)
  })
})
