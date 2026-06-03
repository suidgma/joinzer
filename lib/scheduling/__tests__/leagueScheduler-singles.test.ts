/**
 * Unit tests for singles-only mode in leagueScheduler.
 *
 * Singles leagues (format like open_singles / mens_singles / womens_singles)
 * must produce 1v1 matches only — never doubles. This regression suite locks
 * in that behavior after the bug where a singles league generated a doubles
 * schedule because the scheduler ignored the league format.
 */

import { describe, it, expect } from 'vitest'
import {
  determineRoundFormatSingles,
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

describe('determineRoundFormatSingles', () => {
  it('even players, courts to spare → all in singles, no byes', () => {
    expect(determineRoundFormatSingles(4, 4)).toMatchObject({ doublesCount: 0, singlesCount: 2, byeCount: 0 })
    expect(determineRoundFormatSingles(2, 4)).toMatchObject({ doublesCount: 0, singlesCount: 1, byeCount: 0 })
  })

  it('odd player out takes a bye', () => {
    expect(determineRoundFormatSingles(5, 4)).toMatchObject({ doublesCount: 0, singlesCount: 2, byeCount: 1 })
  })

  it('court-constrained: cap singles at courts, rest bye', () => {
    expect(determineRoundFormatSingles(10, 4)).toMatchObject({ doublesCount: 0, singlesCount: 4, byeCount: 2 })
  })

  it('never returns doubles', () => {
    for (let n = 2; n <= 16; n++) {
      expect(determineRoundFormatSingles(n, 4).doublesCount).toBe(0)
    }
  })
})

describe('generateNextRound in singles mode', () => {
  it('4 singles players on 4 courts → 2 singles matches, 0 doubles, 0 byes', () => {
    // This is the exact "Rick Test" repro: an Open Singles league with 4 present.
    const players = ['Alex', 'Amanda', 'Ben', 'Daniel'].map(id => player(id))
    const round   = generateNextRound(players, [], 4, 1, 50, undefined, true)

    expect(round).not.toBeNull()
    const doubles = round!.matches.filter(m => m.matchType === 'doubles')
    const singles = round!.matches.filter(m => m.matchType === 'singles')
    const byes    = round!.matches.filter(m => m.matchType === 'bye')

    expect(doubles).toHaveLength(0)
    expect(singles).toHaveLength(2)
    expect(byes).toHaveLength(0)

    // Every present player appears in exactly one singles match.
    const scheduled = singles.flatMap(m => [m.singlesPlayer1Id, m.singlesPlayer2Id])
    expect(new Set(scheduled)).toEqual(new Set(['Alex', 'Amanda', 'Ben', 'Daniel']))
  })

  it('avoids repeat opponents across rounds where possible', () => {
    const ids = ['A', 'B', 'C', 'D']
    const players = ids.map(id => player(id))
    const completed = [
      {
        roundNumber: 1,
        matches: [
          { matchType: 'singles' as const, team1: [], team2: [], singles: ['A', 'B'], byePlayerId: null },
          { matchType: 'singles' as const, team1: [], team2: [], singles: ['C', 'D'], byePlayerId: null },
        ],
      },
    ]

    const round = generateNextRound(players, completed, 4, 2, 200, undefined, true)
    expect(round).not.toBeNull()

    // With 4 players who already faced A-B and C-D, round 2 should pair new
    // opponents (A-C/A-D etc.), not reuse A-B + C-D.
    const pairs = round!.matches
      .filter(m => m.matchType === 'singles')
      .map(m => new Set([m.singlesPlayer1Id, m.singlesPlayer2Id]))

    const hasAB = pairs.some(s => s.has('A') && s.has('B'))
    const hasCD = pairs.some(s => s.has('C') && s.has('D'))
    expect(hasAB && hasCD).toBe(false)
  })

  it('never emits a doubles match regardless of count', () => {
    for (let n = 4; n <= 12; n++) {
      const players = Array.from({ length: n }, (_, i) => player(`P${i}`))
      const round   = generateNextRound(players, [], 4, 1, 30, undefined, true)
      expect(round).not.toBeNull()
      expect(round!.matches.some(m => m.matchType === 'doubles')).toBe(false)
    }
  })
})
