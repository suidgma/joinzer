import { describe, it, expect } from 'vitest'
import { computeBadges, type BadgeInput } from '../badges'

const base: BadgeInput = {
  createdAt: '2026-07-01T00:00:00Z',
  confidence: 'provisional',
  matches: 0,
  leaguesPlayed: 0,
  tournamentsPlayed: 0,
  currentStreak: null,
}
const keys = (i: Partial<BadgeInput>) => computeBadges({ ...base, ...i }).map((b) => b.key)

describe('computeBadges', () => {
  it('a brand-new provisional player in the launch year gets only Early Member', () => {
    expect(keys({})).toEqual(['early'])
  })

  it('established (or rusty) rating earns the Established badge', () => {
    expect(keys({ confidence: 'established' })).toContain('established')
    expect(keys({ confidence: 'rusty' })).toContain('established')
    expect(keys({ confidence: 'provisional' })).not.toContain('established')
  })

  it('shows only the highest match milestone', () => {
    expect(keys({ matches: 9 })).not.toContain('m10')
    expect(keys({ matches: 10 })).toContain('m10')
    expect(keys({ matches: 60 })).toEqual(expect.arrayContaining(['m50']))
    expect(keys({ matches: 60 })).not.toContain('m10')
    expect(keys({ matches: 120 })).toContain('m100')
    expect(keys({ matches: 120 })).not.toContain('m50')
  })

  it('hot-streak badge only for a win streak of 5+', () => {
    expect(keys({ currentStreak: { type: 'W', count: 4 } })).not.toContain('streak')
    expect(keys({ currentStreak: { type: 'W', count: 5 } })).toContain('streak')
    expect(keys({ currentStreak: { type: 'L', count: 8 } })).not.toContain('streak')
    const label = computeBadges({ ...base, currentStreak: { type: 'W', count: 7 } }).find((b) => b.key === 'streak')?.label
    expect(label).toBe('7-Win Streak')
  })

  it('tournament / league participation badges', () => {
    expect(keys({ tournamentsPlayed: 1 })).toContain('tournament')
    expect(keys({ leaguesPlayed: 2 })).toContain('league')
    expect(keys({ tournamentsPlayed: 0, leaguesPlayed: 0 })).not.toEqual(expect.arrayContaining(['tournament', 'league']))
  })

  it('Early Member only for launch-year joiners', () => {
    expect(keys({ createdAt: '2026-12-31T23:00:00Z' })).toContain('early')
    expect(keys({ createdAt: '2027-03-01T00:00:00Z' })).not.toContain('early')
    expect(keys({ createdAt: null })).not.toContain('early')
  })

  it('a decorated player stacks multiple badges in priority order', () => {
    const b = computeBadges({
      createdAt: '2026-05-01T00:00:00Z',
      confidence: 'established',
      matches: 120,
      leaguesPlayed: 3,
      tournamentsPlayed: 2,
      currentStreak: { type: 'W', count: 6 },
    })
    expect(b.map((x) => x.key)).toEqual(['established', 'm100', 'streak', 'tournament', 'league', 'early'])
  })
})
