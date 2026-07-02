import { describe, it, expect } from 'vitest'
import { validateScores } from '../validateScores'

describe('validateScores', () => {
  it('accepts a valid non-tie result (incl. a legit 0)', () => {
    expect(validateScores(11, 7)).toEqual({ ok: true })
    expect(validateScores(0, 11)).toEqual({ ok: true })
  })

  it('rejects non-numbers', () => {
    expect(validateScores('11', 7)).toMatchObject({ ok: false, error: 'Scores must be numbers' })
    expect(validateScores(11, undefined)).toMatchObject({ ok: false })
    expect(validateScores(null, null)).toMatchObject({ ok: false })
  })

  it('rejects negative scores', () => {
    expect(validateScores(-1, 5)).toMatchObject({ ok: false, error: 'Scores cannot be negative' })
  })

  it('rejects ties', () => {
    expect(validateScores(11, 11)).toMatchObject({ ok: false, error: 'Tie scores are not allowed' })
  })
})
