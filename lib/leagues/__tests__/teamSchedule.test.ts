import { describe, it, expect } from 'vitest'
import { buildTeamRoundRobin } from '../teamSchedule'

const pairKey = (a: string, b: string) => [a, b].sort().join('|')
const allPairs = (days: ReturnType<typeof buildTeamRoundRobin>) =>
  days.flatMap((d) => d.matchups.map((m) => pairKey(m.team1Id, m.team2Id)))

describe('buildTeamRoundRobin', () => {
  it('returns nothing for fewer than 2 teams', () => {
    expect(buildTeamRoundRobin([])).toEqual([])
    expect(buildTeamRoundRobin(['a'])).toEqual([])
  })

  it('even N: N-1 matchdays, every pair exactly once, no team twice in a round', () => {
    const teams = ['a', 'b', 'c', 'd']
    const days = buildTeamRoundRobin(teams)
    expect(days).toHaveLength(3) // N-1
    // every unique pairing appears exactly once
    const pairs = allPairs(days)
    expect(pairs.sort()).toEqual(['a|b', 'a|c', 'a|d', 'b|c', 'b|d', 'c|d'])
    // no team plays twice on a matchday
    for (const d of days) {
      const seen = d.matchups.flatMap((m) => [m.team1Id, m.team2Id])
      expect(new Set(seen).size).toBe(seen.length)
      expect(d.byeTeamId).toBeNull() // even → no byes
    }
  })

  it('odd N: N matchdays with exactly one bye each; every pair once', () => {
    const teams = ['a', 'b', 'c', 'd', 'e']
    const days = buildTeamRoundRobin(teams)
    expect(days).toHaveLength(5) // N
    for (const d of days) {
      expect(d.matchups).toHaveLength(2) // (N-1)/2
      expect(d.byeTeamId).not.toBeNull()
      const playing = d.matchups.flatMap((m) => [m.team1Id, m.team2Id])
      expect(playing).not.toContain(d.byeTeamId) // the bye team isn't playing
    }
    // 5 teams → C(5,2) = 10 unique pairings, each once
    expect(new Set(allPairs(days)).size).toBe(10)
    expect(allPairs(days)).toHaveLength(10)
  })

  it('is deterministic for a given team order', () => {
    const teams = ['a', 'b', 'c', 'd']
    expect(buildTeamRoundRobin(teams)).toEqual(buildTeamRoundRobin(teams))
  })
})
