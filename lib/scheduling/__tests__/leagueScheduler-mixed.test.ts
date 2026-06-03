/**
 * Unit tests for mixed-doubles mode in leagueScheduler.
 *
 * Mixed doubles (format 'mixed_doubles') requires every doubles team to be one
 * man + one woman. This regression suite locks in that behavior after the bug
 * where a mixed-doubles league produced same-gender teams because the scheduler
 * had no gender awareness and paired players at random.
 */

import { describe, it, expect } from 'vitest'
import {
  determineRoundFormatMixed,
  generateNextRound,
  genderBucket,
  type SessionPlayer,
  type GeneratedRound,
} from '../leagueScheduler'

function player(id: string, gender: string, present = true): SessionPlayer {
  return {
    id,
    userId:            id,
    name:              id,
    playerType:        'roster_player',
    actualStatus:      present ? 'present' : 'not_present',
    arrivedAfterRound: null,
    joinzerRating:     1000,
    gender,
  }
}

describe('genderBucket', () => {
  it('normalizes common gender strings', () => {
    expect(genderBucket('male')).toBe('male')
    expect(genderBucket('Female')).toBe('female')
    expect(genderBucket('M')).toBe('male')
    expect(genderBucket('women')).toBe('female')
  })
  it('treats null/unknown as other', () => {
    expect(genderBucket(null)).toBe('other')
    expect(genderBucket(undefined)).toBe('other')
    expect(genderBucket('nonbinary')).toBe('other')
  })
})

describe('determineRoundFormatMixed', () => {
  it('balanced rosters fill mixed courts, no byes', () => {
    expect(determineRoundFormatMixed(2, 2, 0, 4)).toMatchObject({ doublesCount: 1, singlesCount: 0, byeCount: 0 })
    expect(determineRoundFormatMixed(4, 4, 0, 4)).toMatchObject({ doublesCount: 2, singlesCount: 0, byeCount: 0 })
  })

  it('cannot form a mixed match without 2 of each gender → warns', () => {
    const f = determineRoundFormatMixed(4, 0, 0, 4)
    expect(f.doublesCount).toBe(0)
    expect(f.warning).toMatch(/at least 2 men and 2 women/i)
  })

  it('gender-imbalanced roster: caps doubles at scarcer gender, warns', () => {
    // 5 men, 3 women, 4 courts: only 1 mixed match (limited by women).
    const f = determineRoundFormatMixed(5, 3, 0, 4)
    expect(f.doublesCount).toBe(1)
    expect(f.warning).toMatch(/gender-imbalanced/i)
  })

  it('court-constrained: caps doubles at courts, rest bye', () => {
    expect(determineRoundFormatMixed(4, 4, 0, 1)).toMatchObject({ doublesCount: 1, singlesCount: 0, byeCount: 4 })
  })
})

describe('generateNextRound in mixed-doubles mode', () => {
  function assertAllTeamsMixed(round: GeneratedRound | null) {
    expect(round).not.toBeNull()
    const males   = new Set(['Greg', 'Eric', 'Jason', 'Jordan', 'Kevin'])
    const females = new Set(['Emma', 'Grace', 'Olivia', 'Maya'])
    for (const m of round!.matches) {
      if (m.matchType !== 'doubles') continue
      for (const team of [[m.team1Player1Id, m.team1Player2Id], [m.team2Player1Id, m.team2Player2Id]]) {
        const [a, b] = team
        const maleOnTeam   = [a, b].filter(id => id && males.has(id)).length
        const femaleOnTeam = [a, b].filter(id => id && females.has(id)).length
        expect(maleOnTeam).toBe(1)
        expect(femaleOnTeam).toBe(1)
      }
    }
  }

  it('balanced 4M+4F → 2 mixed matches, every team 1M+1F', () => {
    const players = [
      player('Greg', 'male'), player('Eric', 'male'), player('Jason', 'male'), player('Jordan', 'male'),
      player('Emma', 'female'), player('Grace', 'female'), player('Olivia', 'female'), player('Maya', 'female'),
    ]
    const round = generateNextRound(players, [], 4, 1, 100, undefined, false, true)
    expect(round).not.toBeNull()
    const doubles = round!.matches.filter(m => m.matchType === 'doubles')
    expect(doubles).toHaveLength(2)
    assertAllTeamsMixed(round)
  })

  it('never produces a same-gender team on an imbalanced roster', () => {
    // 5 men, 3 women — the exact "Doubles r" repro that exposed the bug.
    const players = [
      player('Greg', 'male'), player('Eric', 'male'), player('Jason', 'male'),
      player('Jordan', 'male'), player('Kevin', 'male'),
      player('Emma', 'female'), player('Grace', 'female'), player('Olivia', 'female'),
    ]
    for (let r = 1; r <= 5; r++) {
      const round = generateNextRound(players, [], 4, r, 100, undefined, false, true)
      expect(round).not.toBeNull()
      assertAllTeamsMixed(round)
      expect(round!.notes.some(n => /gender-imbalanced/i.test(n))).toBe(true)
    }
  })

  it('all-male roster cannot form mixed doubles → no doubles match', () => {
    const players = ['Greg', 'Eric', 'Jason', 'Jordan'].map(id => player(id, 'male'))
    const round = generateNextRound(players, [], 4, 1, 50, undefined, false, true)
    expect(round).not.toBeNull()
    expect(round!.matches.some(m => m.matchType === 'doubles')).toBe(false)
    expect(round!.notes.some(n => /at least 2 men and 2 women/i.test(n))).toBe(true)
  })
})
