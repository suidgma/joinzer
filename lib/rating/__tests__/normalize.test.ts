import { describe, it, expect } from 'vitest'
import { scoreFromInternal, internalFromScore } from '../normalize'
import { scoreToLevel } from '../levels'

describe('scoreFromInternal', () => {
  it('maps the default rating (1500) to 50 — average club player', () => {
    expect(scoreFromInternal('pickleball', 1500)).toBe(50)
  })

  it('is monotonic increasing', () => {
    expect(scoreFromInternal('pickleball', 1200)).toBeLessThan(scoreFromInternal('pickleball', 1500))
    expect(scoreFromInternal('pickleball', 1500)).toBeLessThan(scoreFromInternal('pickleball', 1800))
  })

  it('clamps to [0, 100]', () => {
    expect(scoreFromInternal('pickleball', -5000)).toBe(0)
    expect(scoreFromInternal('pickleball', 9000)).toBe(100)
  })

  it('lands anchor ratings in sensible Joinzer Levels', () => {
    expect(scoreToLevel('pickleball', scoreFromInternal('pickleball', 1500))).toBe('Intermediate')
    expect(['Advanced', 'Elite']).toContain(scoreToLevel('pickleball', scoreFromInternal('pickleball', 1800)))
    expect(['New Player', 'Beginner']).toContain(scoreToLevel('pickleball', scoreFromInternal('pickleball', 1150)))
  })
})

describe('internalFromScore', () => {
  it('score 50 → rating 1500', () => {
    expect(internalFromScore('pickleball', 50)).toBeCloseTo(1500, 5)
  })

  it('round-trips mid-range ratings within a few points (integer-score rounding)', () => {
    for (const r of [1300, 1450, 1500, 1650, 1800]) {
      const roundTrip = internalFromScore('pickleball', scoreFromInternal('pickleball', r))
      expect(roundTrip).toBeCloseTo(r, -1) // within ~5 rating points
    }
  })
})
