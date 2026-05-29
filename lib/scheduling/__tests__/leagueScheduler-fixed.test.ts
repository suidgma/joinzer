/**
 * Unit tests for fixed-partner mode in leagueScheduler.
 *
 * In fixed mode the scheduler honors the partner pairings from registration:
 *   - Pairs whose both members are present go to doubles courts (two pairs per court)
 *   - Pairs that don't fit on a doubles court bye together
 *   - Orphans (present player, absent partner) fill singles or bye — never re-paired
 *
 * Rotating mode behavior is covered by the existing scheduler integration; these
 * tests focus on what fixed mode does differently.
 */

import { describe, it, expect } from 'vitest'
import {
  determineRoundFormatFixed,
  resolvePresentPairs,
  generateNextRound,
  type SessionPlayer,
} from '../leagueScheduler'

function player(id: string, present = true): SessionPlayer {
  return {
    id,
    userId:            id,
    name:              id,
    playerType:        'roster_player',
    actualStatus:      present ? 'present' : 'not_present',
    arrivedAfterRound: null,
    joinzerRating:     1000,
  }
}

function pairMap(pairs: Array<[string, string]>): Map<string, string> {
  const m = new Map<string, string>()
  for (const [a, b] of pairs) { m.set(a, b); m.set(b, a) }
  return m
}

describe('determineRoundFormatFixed', () => {
  it('all present: N pairs → N/2 doubles courts, 0 byes', () => {
    expect(determineRoundFormatFixed(4, 0, 4)).toMatchObject({ doublesCount: 2, singlesCount: 0, byeCount: 0 })
    expect(determineRoundFormatFixed(2, 0, 4)).toMatchObject({ doublesCount: 1, singlesCount: 0, byeCount: 0 })
  })

  it('odd # of pairs: one pair byes together (byeCount=2)', () => {
    expect(determineRoundFormatFixed(3, 0, 4)).toMatchObject({ doublesCount: 1, singlesCount: 0, byeCount: 2 })
  })

  it('two orphans + free court: singles match between them', () => {
    expect(determineRoundFormatFixed(2, 2, 4)).toMatchObject({ doublesCount: 1, singlesCount: 1, byeCount: 0 })
  })

  it('one orphan: byes alone (no singles partner)', () => {
    expect(determineRoundFormatFixed(2, 1, 4)).toMatchObject({ doublesCount: 1, singlesCount: 0, byeCount: 1 })
  })

  it('court-constrained: cap doubles at courts even if pairs would allow more', () => {
    expect(determineRoundFormatFixed(4, 0, 1)).toMatchObject({ doublesCount: 1, singlesCount: 0, byeCount: 4 })
  })
})

describe('resolvePresentPairs', () => {
  it('returns whole present pairs and skips canonical duplicates', () => {
    const players = ['A', 'B', 'C', 'D'].map(id => player(id))
    const pairs   = pairMap([['A', 'B'], ['C', 'D']])
    const { presentPairs, orphans } = resolvePresentPairs(players, pairs)
    expect(presentPairs).toHaveLength(2)
    expect(orphans).toEqual([])
  })

  it('returns the present partner as an orphan when partner is absent', () => {
    // Pair (A, B). Only A is present.
    const players = [player('A')]
    const pairs   = pairMap([['A', 'B']])
    const { presentPairs, orphans } = resolvePresentPairs(players, pairs)
    expect(presentPairs).toEqual([])
    expect(orphans).toEqual(['A'])
  })

  it('returns an unpaired player as an orphan', () => {
    const players = [player('X')]
    const pairs   = pairMap([['A', 'B']])
    const { presentPairs, orphans } = resolvePresentPairs(players, pairs)
    expect(presentPairs).toEqual([])
    expect(orphans).toEqual(['X'])
  })
})

describe('generateNextRound in fixed mode', () => {
  it('always pairs the same registration-time partners in doubles matches', () => {
    // 8 players in 4 known pairs. Run 5 rounds. Confirm Alice always plays
    // with Bob, never with Carol/Diana/etc.
    const players = ['Alice','Bob','Carol','Diana','Eve','Frank','Gus','Helen'].map(id => player(id))
    const pairs = pairMap([
      ['Alice', 'Bob'],
      ['Carol', 'Diana'],
      ['Eve',   'Frank'],
      ['Gus',   'Helen'],
    ])

    for (let r = 1; r <= 5; r++) {
      const round = generateNextRound(players, [], 4, r, 50, pairs)
      expect(round).not.toBeNull()
      for (const m of round!.matches) {
        if (m.matchType !== 'doubles') continue
        const team1 = new Set([m.team1Player1Id, m.team1Player2Id])
        const team2 = new Set([m.team2Player1Id, m.team2Player2Id])

        // Each team is one whole registered pair.
        expect(
          (team1.has('Alice') && team1.has('Bob')) ||
          (team1.has('Carol') && team1.has('Diana')) ||
          (team1.has('Eve') && team1.has('Frank')) ||
          (team1.has('Gus') && team1.has('Helen'))
        ).toBe(true)
        expect(
          (team2.has('Alice') && team2.has('Bob')) ||
          (team2.has('Carol') && team2.has('Diana')) ||
          (team2.has('Eve') && team2.has('Frank')) ||
          (team2.has('Gus') && team2.has('Helen'))
        ).toBe(true)
      }
    }
  })

  it('orphan with absent partner plays singles or byes — never re-paired', () => {
    // Alice's partner Bob is absent. Carol+Diana both present (pair). Eve's
    // partner Frank also absent. Two orphans (Alice + Eve), one pair (Carol+Diana).
    const players = [player('Alice'), player('Carol'), player('Diana'), player('Eve')]
    const pairs   = pairMap([['Alice', 'Bob'], ['Carol', 'Diana'], ['Eve', 'Frank']])
    const round   = generateNextRound(players, [], 4, 1, 50, pairs)

    expect(round).not.toBeNull()

    // Carol+Diana should be in a doubles match together... but they're the
    // only pair so they can't form a doubles match (needs 2 pairs). They bye
    // together. Alice + Eve fill the singles court.
    const doublesMatches = round!.matches.filter(m => m.matchType === 'doubles')
    const singlesMatches = round!.matches.filter(m => m.matchType === 'singles')
    const byeMatches     = round!.matches.filter(m => m.matchType === 'bye')

    expect(doublesMatches).toHaveLength(0)
    expect(singlesMatches).toHaveLength(1)
    expect(byeMatches).toHaveLength(2)

    // The singles match is between the two orphans (any order).
    const singlesPlayers = new Set([singlesMatches[0].singlesPlayer1Id, singlesMatches[0].singlesPlayer2Id])
    expect(singlesPlayers).toEqual(new Set(['Alice', 'Eve']))

    // Carol and Diana both bye (the pair).
    const byePlayers = new Set(byeMatches.map(m => m.byePlayerId))
    expect(byePlayers).toEqual(new Set(['Carol', 'Diana']))
  })

  it('rotating mode (default, no fixedPairs) preserves existing behavior', () => {
    // No fixedPairs argument → original generateCandidate path. Just confirm
    // it still produces a valid round.
    const players = ['A','B','C','D','E','F','G','H'].map(id => player(id))
    const round   = generateNextRound(players, [], 4, 1, 50)
    expect(round).not.toBeNull()
    expect(round!.matches.length).toBeGreaterThan(0)
  })

  it('empty fixedPairs map is treated as rotating mode', () => {
    const players = ['A','B','C','D'].map(id => player(id))
    const round   = generateNextRound(players, [], 4, 1, 50, new Map())
    expect(round).not.toBeNull()
  })
})
