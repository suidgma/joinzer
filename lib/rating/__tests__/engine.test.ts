import { describe, it, expect } from 'vitest'
import { computeRatings, confidenceState, type PlayerRatingState } from '../engine'
import type { GameRecord } from '../types'

const g = (over: Partial<GameRecord> & Pick<GameRecord, 'id' | 'playedAt' | 'sideA' | 'sideB' | 'winner'>): GameRecord => ({
  activity: 'pickleball', format: 'singles', source: 'league', competitionId: 'c', occasionId: over.occasionId ?? 'occ', ...over,
})
const find = (rows: PlayerRatingState[], player: string, format = 'singles') =>
  rows.find((r) => r.playerId === player && r.format === format)!

describe('confidenceState (locked gate: RD<110 & ≥15 games & ≥3 events)', () => {
  it('established only when all three hold', () => {
    expect(confidenceState({ rd: 80, gamesCounted: 15, eventsCounted: 3 })).toBe('established')
    expect(confidenceState({ rd: 150, gamesCounted: 15, eventsCounted: 3 })).toBe('rusty') // volume met, RD regrew
    expect(confidenceState({ rd: 80, gamesCounted: 10, eventsCounted: 3 })).toBe('provisional')
    expect(confidenceState({ rd: 80, gamesCounted: 15, eventsCounted: 2 })).toBe('provisional')
  })
})

describe('computeRatings', () => {
  it('a consistent winner rises above a consistent loser', () => {
    const games: GameRecord[] = Array.from({ length: 6 }, (_, i) =>
      g({ id: `m${i}`, playedAt: `2026-01-${String(1 + i * 7).padStart(2, '0')}T12:00:00Z`, occasionId: `s${i}`, sideA: ['a'], sideB: ['b'], winner: 'A' }),
    )
    const rows = computeRatings(games)
    expect(find(rows, 'a').rating).toBeGreaterThan(1500)
    expect(find(rows, 'b').rating).toBeLessThan(1500)
    expect(find(rows, 'a').rating).toBeGreaterThan(find(rows, 'b').rating)
  })

  it('doubles: both winners rise, both losers fall', () => {
    const rows = computeRatings([
      g({ id: 'd1', playedAt: '2026-01-01T12:00:00Z', format: 'doubles', sideA: ['a', 'b'], sideB: ['c', 'd'], winner: 'A' }),
    ])
    expect(find(rows, 'a', 'doubles').rating).toBeGreaterThan(1500)
    expect(find(rows, 'b', 'doubles').rating).toBeGreaterThan(1500)
    expect(find(rows, 'c', 'doubles').rating).toBeLessThan(1500)
    expect(find(rows, 'd', 'doubles').rating).toBeLessThan(1500)
  })

  it('counts games and distinct events; keeps singles and doubles separate', () => {
    const rows = computeRatings([
      g({ id: 's1', playedAt: '2026-01-01T00:00:00Z', occasionId: 'sess1', sideA: ['a'], sideB: ['b'], winner: 'A' }),
      g({ id: 's2', playedAt: '2026-01-02T00:00:00Z', occasionId: 'sess1', sideA: ['a'], sideB: ['b'], winner: 'A' }),
      g({ id: 'd1', playedAt: '2026-01-03T00:00:00Z', occasionId: 'sess2', format: 'doubles', sideA: ['a', 'c'], sideB: ['b', 'd'], winner: 'A' }),
    ])
    const aSingles = find(rows, 'a', 'singles')
    const aDoubles = find(rows, 'a', 'doubles')
    expect(aSingles.gamesCounted).toBe(2)
    expect(aSingles.eventsCounted).toBe(1)
    expect(aDoubles.gamesCounted).toBe(1)
    expect(aDoubles.eventsCounted).toBe(1)
  })

  it('is deterministic regardless of input order', () => {
    const games: GameRecord[] = Array.from({ length: 8 }, (_, i) =>
      g({ id: `m${i}`, playedAt: `2026-02-${String(1 + i).padStart(2, '0')}T12:00:00Z`, occasionId: `s${i}`, sideA: [i % 2 ? 'a' : 'b'], sideB: [i % 2 ? 'b' : 'a'], winner: 'A' }),
    )
    const forward = computeRatings(games)
    const reversed = computeRatings([...games].reverse())
    expect(find(reversed, 'a').rating).toBeCloseTo(find(forward, 'a').rating, 6)
    expect(find(reversed, 'b').rating).toBeCloseTo(find(forward, 'b').rating, 6)
  })

  it('inactivity grows RD (drives Rusty) via asOf', () => {
    const games: GameRecord[] = Array.from({ length: 4 }, (_, i) =>
      g({ id: `m${i}`, playedAt: `2026-01-${String(1 + i * 7).padStart(2, '0')}T12:00:00Z`, occasionId: `s${i}`, sideA: ['a'], sideB: ['b'], winner: i % 2 ? 'A' : 'B' }),
    )
    const fresh = computeRatings(games, () => null, { asOf: '2026-01-25T12:00:00Z' })
    const stale = computeRatings(games, () => null, { asOf: '2027-01-25T12:00:00Z' })
    expect(find(stale, 'a').rd).toBeGreaterThan(find(fresh, 'a').rd)
  })

  it('records one history snapshot per rating period played (for the trend)', () => {
    const games: GameRecord[] = Array.from({ length: 3 }, (_, i) =>
      g({ id: `m${i}`, playedAt: `2026-01-${String(1 + i * 7).padStart(2, '0')}T12:00:00Z`, occasionId: `s${i}`, sideA: ['a'], sideB: ['b'], winner: 'A' }),
    )
    const rows = computeRatings(games)
    const a = find(rows, 'a')
    expect(a.history).toHaveLength(3) // three separate weeks → three snapshots
    expect(a.history[a.history.length - 1].games).toBe(3)
    expect(a.history[a.history.length - 1].rating).toBeCloseTo(a.rating, 6)
  })

  it('honors the seed function for a player with no games as the starting point', () => {
    const rows = computeRatings(
      [g({ id: 'm1', playedAt: '2026-01-01T00:00:00Z', sideA: ['a'], sideB: ['b'], winner: 'A' })],
      (pid) => (pid === 'a' ? { rating: 1900 } : { rating: 1300 }),
    )
    // 'a' started high and won → stays clearly above 'b'
    expect(find(rows, 'a').rating).toBeGreaterThan(find(rows, 'b').rating + 200)
  })
})
