import { describe, it, expect } from 'vitest'
import { pickPrimaryFormat } from '../recompute'
import type { PlayerRatingState } from '../engine'

const track = (over: Partial<PlayerRatingState> & Pick<PlayerRatingState, 'format' | 'confidence' | 'gamesCounted'>): PlayerRatingState => ({
  playerId: 'p', activity: 'pickleball', rating: 1500, rd: 100, vol: 0.06,
  eventsCounted: 3, lastPlayedAt: null, basis: 'calculated', history: [], ...over,
})

describe('pickPrimaryFormat — prefer Established (doubles wins ties), else most-played', () => {
  it('features the Established format over a provisional one', () => {
    const p = pickPrimaryFormat([
      track({ format: 'doubles', confidence: 'provisional', gamesCounted: 40 }),
      track({ format: 'singles', confidence: 'established', gamesCounted: 20 }),
    ])
    expect(p.format).toBe('singles')
  })

  it('doubles wins ties when both formats are Established', () => {
    const p = pickPrimaryFormat([
      track({ format: 'singles', confidence: 'established', gamesCounted: 30 }),
      track({ format: 'doubles', confidence: 'established', gamesCounted: 20 }),
    ])
    expect(p.format).toBe('doubles')
  })

  it('falls back to the most-played format when neither is Established', () => {
    const p = pickPrimaryFormat([
      track({ format: 'doubles', confidence: 'provisional', gamesCounted: 5 }),
      track({ format: 'singles', confidence: 'provisional', gamesCounted: 12 }),
    ])
    expect(p.format).toBe('singles')
  })

  it('doubles wins ties among most-played', () => {
    const p = pickPrimaryFormat([
      track({ format: 'singles', confidence: 'provisional', gamesCounted: 10 }),
      track({ format: 'doubles', confidence: 'provisional', gamesCounted: 10 }),
    ])
    expect(p.format).toBe('doubles')
  })
})
