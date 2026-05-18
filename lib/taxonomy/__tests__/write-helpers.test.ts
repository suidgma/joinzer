import { describe, it, expect } from 'vitest'
import { prepareLeagueWrite, prepareDivisionWrite, prepareEventWrite } from '../write-helpers'

// ── prepareLeagueWrite ────────────────────────────────────────────────────────

describe('prepareLeagueWrite', () => {
  it('maps every LEAGUE_SKILL_TO_RANGE entry correctly', () => {
    const cases: Array<[string, number, number]> = [
      ['beginner',          2.0, 2.5],
      ['beginner_plus',     2.5, 3.0],
      ['intermediate',      3.0, 3.5],
      ['intermediate_plus', 3.5, 4.0],
      ['advanced',          4.0, 4.5],
      ['advanced_plus',     4.5, 5.0],
    ]
    for (const [skill_level, min, max] of cases) {
      const result = prepareLeagueWrite({ format: 'mixed_doubles', skill_level })
      expect(result.skill_min).toBe(min)
      expect(result.skill_max).toBe(max)
    }
  })

  it('returns null range for unknown skill_level', () => {
    const result = prepareLeagueWrite({ format: 'mixed_doubles', skill_level: 'expert' })
    expect(result.skill_min).toBeNull()
    expect(result.skill_max).toBeNull()
  })

  it('returns null range for empty string skill_level', () => {
    const result = prepareLeagueWrite({ format: 'mixed_doubles', skill_level: '' })
    expect(result.skill_min).toBeNull()
    expect(result.skill_max).toBeNull()
  })

  it('passes format and skill_level through unchanged', () => {
    const result = prepareLeagueWrite({ format: 'mens_doubles', skill_level: 'advanced' })
    expect(result.format).toBe('mens_doubles')
    expect(result.skill_level).toBe('advanced')
  })
})

// ── prepareDivisionWrite ──────────────────────────────────────────────────────

describe('prepareDivisionWrite', () => {
  it('maps all 8 Phase 1 category+team_type pairs to the correct format', () => {
    const cases: Array<[string, string, string]> = [
      ['mens_doubles',   'doubles', 'mens_doubles'],
      ['womens_doubles', 'doubles', 'womens_doubles'],
      ['mixed_doubles',  'doubles', 'mixed_doubles'],
      ['singles',        'singles', 'mens_singles'],
      ['open',           'singles', 'open_singles'],
      ['mens_doubles',   'singles', 'mens_singles'],
      ['womens_doubles', 'singles', 'womens_singles'],
      ['mixed_doubles',  'singles', 'open_singles'],
    ]
    for (const [category, team_type, expected] of cases) {
      const result = prepareDivisionWrite({ category, team_type, skill_level: null })
      expect(result.format).toBe(expected)
    }
  })

  it('generic fallback: unknown category + doubles → mixed_doubles', () => {
    const result = prepareDivisionWrite({ category: 'open', team_type: 'doubles', skill_level: null })
    expect(result.format).toBe('mixed_doubles')
  })

  it('generic fallback: unknown category + singles → open_singles', () => {
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
      const result = prepareDivisionWrite({ category: 'mixed_doubles', team_type: 'doubles', skill_level })
      expect(result.skill_min).toBe(min)
      expect(result.skill_max).toBe(max)
    }
  })

  it('lowercase skill_level returns null range (proves Title-Case-keyed table)', () => {
    const result = prepareDivisionWrite({ category: 'mixed_doubles', team_type: 'doubles', skill_level: 'beginner' })
    expect(result.skill_min).toBeNull()
    expect(result.skill_max).toBeNull()
  })

  it('null skill_level returns null range', () => {
    const result = prepareDivisionWrite({ category: 'mixed_doubles', team_type: 'doubles', skill_level: null })
    expect(result.skill_min).toBeNull()
    expect(result.skill_max).toBeNull()
  })

  it('passes legacy fields through unchanged', () => {
    const result = prepareDivisionWrite({ category: 'mens_doubles', team_type: 'doubles', skill_level: 'Advanced' })
    expect(result.category).toBe('mens_doubles')
    expect(result.team_type).toBe('doubles')
    expect(result.skill_level).toBe('Advanced')
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
