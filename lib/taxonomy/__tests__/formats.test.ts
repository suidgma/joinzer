import { describe, it, expect } from 'vitest'
import { DOUBLES_FORMATS, isDoublesFormat, formatSkillRange } from '../formats'

// ── isDoublesFormat ───────────────────────────────────────────────────────────

describe('isDoublesFormat', () => {
  it('returns true for mens_doubles', () => {
    expect(isDoublesFormat('mens_doubles')).toBe(true)
  })

  it('returns true for womens_doubles', () => {
    expect(isDoublesFormat('womens_doubles')).toBe(true)
  })

  it('returns true for mixed_doubles', () => {
    expect(isDoublesFormat('mixed_doubles')).toBe(true)
  })

  it('returns true for coed_doubles', () => {
    expect(isDoublesFormat('coed_doubles')).toBe(true)
  })

  it('returns true for open_doubles', () => {
    expect(isDoublesFormat('open_doubles')).toBe(true)
  })

  it('returns false for mens_singles', () => {
    expect(isDoublesFormat('mens_singles')).toBe(false)
  })

  it('returns false for womens_singles', () => {
    expect(isDoublesFormat('womens_singles')).toBe(false)
  })

  it('returns false for open_singles', () => {
    expect(isDoublesFormat('open_singles')).toBe(false)
  })

  it('returns false for individual_round_robin', () => {
    expect(isDoublesFormat('individual_round_robin')).toBe(false)
  })

  it('returns false for custom', () => {
    expect(isDoublesFormat('custom')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isDoublesFormat(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isDoublesFormat(undefined)).toBe(false)
  })

  it('DOUBLES_FORMATS contains exactly 5 entries', () => {
    expect(DOUBLES_FORMATS).toHaveLength(5)
  })
})

// ── formatSkillRange ──────────────────────────────────────────────────────────

describe('formatSkillRange', () => {
  it('returns null when both min and max are null', () => {
    expect(formatSkillRange(null, null)).toBeNull()
  })

  it('returns bounded range when both provided', () => {
    expect(formatSkillRange(3.0, 4.0)).toBe('3.0 – 4.0')
  })

  it('returns "X and up" when only min is provided', () => {
    expect(formatSkillRange(3.5, null)).toBe('3.5 and up')
  })

  it('returns "Up to X" when only max is provided', () => {
    expect(formatSkillRange(null, 4.5)).toBe('Up to 4.5')
  })

  it('formats values to one decimal place', () => {
    expect(formatSkillRange(3, 4)).toBe('3.0 – 4.0')
  })
})
