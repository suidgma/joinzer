import { describe, it, expect } from 'vitest'
import { updateRating, applyInactivity, DEFAULT_RD } from '../glicko2'

describe('Glicko-2 — Glickman published worked example', () => {
  // From "Example of the Glicko-2 system" (Glickman): a player rated 1500/RD 200/vol 0.06
  // plays three games (W vs 1400/30, L vs 1550/100, L vs 1700/300), τ=0.5.
  // Expected: rating' ≈ 1464.06, RD' ≈ 151.52, vol' ≈ 0.05999.
  it('reproduces the paper result', () => {
    const out = updateRating(
      { rating: 1500, rd: 200, vol: 0.06 },
      [
        { opponentRating: 1400, opponentRd: 30, score: 1 },
        { opponentRating: 1550, opponentRd: 100, score: 0 },
        { opponentRating: 1700, opponentRd: 300, score: 0 },
      ],
      0.5,
    )
    expect(out.rating).toBeCloseTo(1464.06, 1)
    expect(out.rd).toBeCloseTo(151.52, 1)
    expect(out.vol).toBeCloseTo(0.05999, 4)
  })
})

describe('Glicko-2 — behavior', () => {
  it('empty period = inactivity: RD grows, rating & vol unchanged', () => {
    const after = updateRating({ rating: 1500, rd: 100, vol: 0.06 }, [], 0.5)
    expect(after.rating).toBe(1500)
    expect(after.vol).toBe(0.06)
    expect(after.rd).toBeGreaterThan(100)
  })

  it('inactivity RD is capped at the default (max uncertainty)', () => {
    const after = applyInactivity({ rating: 1500, rd: 349, vol: 0.06 })
    expect(after.rd).toBeLessThanOrEqual(DEFAULT_RD)
  })

  it('beating a stronger opponent raises rating more than beating a weaker one', () => {
    const base = { rating: 1500, rd: 200, vol: 0.06 }
    const vsStrong = updateRating(base, [{ opponentRating: 1800, opponentRd: 50, score: 1 }], 0.5)
    const vsWeak = updateRating(base, [{ opponentRating: 1200, opponentRd: 50, score: 1 }], 0.5)
    expect(vsStrong.rating).toBeGreaterThan(vsWeak.rating)
    expect(vsStrong.rating).toBeGreaterThan(1500)
  })

  it('playing games reduces RD (more certainty)', () => {
    const after = updateRating({ rating: 1500, rd: 200, vol: 0.06 }, [
      { opponentRating: 1500, opponentRd: 50, score: 1 },
      { opponentRating: 1500, opponentRd: 50, score: 0 },
    ], 0.5)
    expect(after.rd).toBeLessThan(200)
  })
})
