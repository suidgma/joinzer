import { describe, it, expect } from 'vitest'
import { everyoneHasFacedEveryone } from '../sessionCompletion'
import type { CompletedRound } from '../../scheduling/leagueScheduler'

// Helper: a singles match between two players in a round.
const singles = (roundNumber: number, pairs: [string, string][]): CompletedRound => ({
  roundNumber,
  matches: pairs.map(([a, b]) => ({
    matchType: 'singles' as const,
    team1: [],
    team2: [],
    singles: [a, b],
    byePlayerId: null,
  })),
})

// Helper: a doubles match (team1 vs team2) in a round.
const doubles = (roundNumber: number, t1: [string, string], t2: [string, string]): CompletedRound => ({
  roundNumber,
  matches: [{ matchType: 'doubles', team1: t1, team2: t2, singles: [], byePlayerId: null }],
})

describe('everyoneHasFacedEveryone', () => {
  it('returns false with fewer than 2 present players', () => {
    expect(everyoneHasFacedEveryone([], [])).toBe(false)
    expect(everyoneHasFacedEveryone(['a'], [])).toBe(false)
  })

  it('returns false when no rounds have been played', () => {
    expect(everyoneHasFacedEveryone(['a', 'b', 'c'], [])).toBe(false)
  })

  it('singles: true once every pair has met', () => {
    // 3 players, a full round-robin: a-b, a-c, b-c
    const rounds = [
      singles(1, [['a', 'b']]),
      singles(2, [['a', 'c']]),
      singles(3, [['b', 'c']]),
    ]
    expect(everyoneHasFacedEveryone(['a', 'b', 'c'], rounds)).toBe(true)
  })

  it('singles: false when a pair is still missing', () => {
    const rounds = [
      singles(1, [['a', 'b']]),
      singles(2, [['a', 'c']]),
      // b vs c never played
    ]
    expect(everyoneHasFacedEveryone(['a', 'b', 'c'], rounds)).toBe(false)
  })

  it('doubles: counts cross-team pairings as faced', () => {
    // a,b vs c,d — this makes a↔c, a↔d, b↔c, b↔d opponents, but NOT a↔b or c↔d.
    const rounds = [doubles(1, ['a', 'b'], ['c', 'd'])]
    // a and b were partners, never opponents → not complete.
    expect(everyoneHasFacedEveryone(['a', 'b', 'c', 'd'], rounds)).toBe(false)

    // Add rounds so every pair has been on opposing sides at least once.
    rounds.push(doubles(2, ['a', 'c'], ['b', 'd'])) // a↔b, a↔d, c↔b, c↔d
    rounds.push(doubles(3, ['a', 'd'], ['b', 'c'])) // a↔b(again), a↔c, d↔b, d↔c
    expect(everyoneHasFacedEveryone(['a', 'b', 'c', 'd'], rounds)).toBe(true)
  })

  it('ignores absent players — completion is judged over the present set only', () => {
    // a,b,c present and all met; d is absent and unmatched — still complete.
    const rounds = [
      singles(1, [['a', 'b']]),
      singles(2, [['a', 'c']]),
      singles(3, [['b', 'c']]),
    ]
    expect(everyoneHasFacedEveryone(['a', 'b', 'c'], rounds)).toBe(true)
  })

  it('a player who only ever sat out (bye) is not complete', () => {
    const rounds: CompletedRound[] = [
      {
        roundNumber: 1,
        matches: [
          { matchType: 'singles', team1: [], team2: [], singles: ['a', 'b'], byePlayerId: null },
          { matchType: 'bye', team1: [], team2: [], singles: [], byePlayerId: 'c' },
        ],
      },
    ]
    // c never faced anyone.
    expect(everyoneHasFacedEveryone(['a', 'b', 'c'], rounds)).toBe(false)
  })
})
