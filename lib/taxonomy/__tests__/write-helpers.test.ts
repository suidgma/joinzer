import { describe, it, expect } from 'vitest'
import { prepareLeagueWrite, prepareDivisionWrite, prepareEventWrite } from '../write-helpers'

// ── prepareLeagueWrite ────────────────────────────────────────────────────────

describe('prepareLeagueWrite', () => {
  it('passes skill_min and skill_max through unchanged', () => {
    const result = prepareLeagueWrite({ format: 'mixed_doubles', skill_min: 3.0, skill_max: 3.5 })
    expect(result.skill_min).toBe(3.0)
    expect(result.skill_max).toBe(3.5)
    expect(result.format).toBe('mixed_doubles')
  })

  it('derives skill_level from skill_min for backward-compat (Phase 4 will drop this)', () => {
    const cases: Array<[number, number, string]> = [
      [2.0, 2.5, 'beginner'],
      [2.5, 3.0, 'beginner_plus'],
      [3.0, 3.5, 'intermediate'],
      [3.5, 4.0, 'intermediate_plus'],
      [4.0, 4.5, 'advanced'],
      [4.5, 5.0, 'advanced'],
    ]
    for (const [min, max] of cases) {
      const result = prepareLeagueWrite({ format: 'mixed_doubles', skill_min: min, skill_max: max })
      expect(result.skill_min).toBe(min)
      expect(result.skill_max).toBe(max)
    }
  })

  it('null inputs produce null skill_min and skill_max', () => {
    const result = prepareLeagueWrite({ format: 'mixed_doubles', skill_min: null, skill_max: null })
    expect(result.skill_min).toBeNull()
    expect(result.skill_max).toBeNull()
  })
})

// ── prepareDivisionWrite ──────────────────────────────────────────────────────

describe('prepareDivisionWrite', () => {
  it('maps every (category, team_type) pair to the correct format', () => {
    // Doubles variants — one row per category in the cleaned-up vocabulary.
    const doublesCases: Array<[string, string]> = [
      ['men',   'mens_doubles'],
      ['women', 'womens_doubles'],
      ['mixed', 'mixed_doubles'],
      ['coed',  'coed_doubles'],
      ['open',  'open_doubles'],
    ]
    for (const [category, expected] of doublesCases) {
      const result = prepareDivisionWrite({ category, team_type: 'doubles', skill_level: null })
      expect(result.format).toBe(expected)
    }

    // Singles variants — men/women get their own format; everything else
    // collapses to open_singles (mixed/coed/unknown have no singles concept).
    const singlesCases: Array<[string, string]> = [
      ['men',   'mens_singles'],
      ['women', 'womens_singles'],
      ['mixed', 'open_singles'],
      ['coed',  'open_singles'],
      ['open',  'open_singles'],
    ]
    for (const [category, expected] of singlesCases) {
      const result = prepareDivisionWrite({ category, team_type: 'singles', skill_level: null })
      expect(result.format).toBe(expected)
    }
  })

  it('doubles fallback: unknown category + doubles → mixed_doubles', () => {
    const result = prepareDivisionWrite({ category: 'unknown', team_type: 'doubles', skill_level: null })
    expect(result.format).toBe('mixed_doubles')
  })

  it('singles fallback: unknown category + singles → open_singles', () => {
    const result = prepareDivisionWrite({ category: 'unknown', team_type: 'singles', skill_level: null })
    expect(result.format).toBe('open_singles')
  })

  it('final fallback: unrecognised team_type → mixed_doubles', () => {
    const result = prepareDivisionWrite({ category: 'unknown', team_type: 'other', skill_level: null })
    expect(result.format).toBe('mixed_doubles')
  })

  it('maps Title Case skill levels correctly', () => {
    const cases: Array<[string, number, number]> = [
      ['Beginner',     2.0, 2.5],
      ['Intermediate', 3.0, 3.5],
      ['Advanced',     4.0, 4.5],
    ]
    for (const [skill_level, min, max] of cases) {
      const result = prepareDivisionWrite({ category: 'mixed', team_type: 'doubles', skill_level })
      expect(result.skill_min).toBe(min)
      expect(result.skill_max).toBe(max)
    }
  })

  it('lowercase skill_level returns null range (proves Title-Case-keyed table)', () => {
    const result = prepareDivisionWrite({ category: 'mixed', team_type: 'doubles', skill_level: 'beginner' })
    expect(result.skill_min).toBeNull()
    expect(result.skill_max).toBeNull()
  })

  it('null skill_level returns null range', () => {
    const result = prepareDivisionWrite({ category: 'mixed', team_type: 'doubles', skill_level: null })
    expect(result.skill_min).toBeNull()
    expect(result.skill_max).toBeNull()
  })

  it('passes category and team_type through unchanged', () => {
    const result = prepareDivisionWrite({ category: 'men', team_type: 'doubles', skill_level: 'Advanced' })
    expect(result.category).toBe('men')
    expect(result.team_type).toBe('doubles')
  })
})

// ── prepareEventWrite ─────────────────────────────────────────────────────────

describe('prepareEventWrite', () => {
  it('copies numeric values to both legacy and new columns', () => {
    const result = prepareEventWrite({ min_skill_level: 3.5, max_skill_level: 4.5 })
    expect(result.min_skill_level).toBe(3.5)
    expect(result.max_skill_level).toBe(4.5)
    expect(result.skill_min).toBe(3.5)
    expect(result.skill_max).toBe(4.5)
  })

  it('null in → null out for both pairs', () => {
    const result = prepareEventWrite({ min_skill_level: null, max_skill_level: null })
    expect(result.skill_min).toBeNull()
    expect(result.skill_max).toBeNull()
  })

  it('mixed null/numeric: min=null, max=4.0', () => {
    const result = prepareEventWrite({ min_skill_level: null, max_skill_level: 4.0 })
    expect(result.skill_min).toBeNull()
    expect(result.skill_max).toBe(4.0)
  })
})
