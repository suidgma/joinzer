import { describe, it, expect } from 'vitest'
import { normalizeTiers, activeTier, resolvePriceCents, nextTierChange } from '../priceTiers'

// $50 through Aug 1, $60 through Sep 1, then full price $70.
const TIERS = [
  { until: '2026-09-01', cents: 6000 }, // intentionally out of order
  { until: '2026-08-01', cents: 5000 },
]
const BASE = 7000

// Noon UTC on a given day → still that calendar day in Pacific (UTC-7/8).
const at = (ymd: string) => new Date(ymd + 'T12:00:00Z')

describe('normalizeTiers', () => {
  it('sorts ascending by until and rounds cents', () => {
    expect(normalizeTiers([{ until: '2026-09-01', cents: 6000.4 }, { until: '2026-08-01', cents: 5000 }]))
      .toEqual([{ until: '2026-08-01', cents: 5000 }, { until: '2026-09-01', cents: 6000 }])
  })
  it('drops malformed entries', () => {
    expect(normalizeTiers([
      { until: 'nope', cents: 100 },
      { until: '2026-08-01' },
      { until: '2026-08-01', cents: -5 },
      { until: '2026-08-01', cents: 5000 },
      null,
      'x',
    ])).toEqual([{ until: '2026-08-01', cents: 5000 }])
  })
  it('returns [] for non-arrays', () => {
    expect(normalizeTiers(null)).toEqual([])
    expect(normalizeTiers(undefined)).toEqual([])
    expect(normalizeTiers({})).toEqual([])
  })
})

describe('resolvePriceCents', () => {
  it('charges the early-bird price before the first deadline', () => {
    expect(resolvePriceCents(BASE, TIERS, at('2026-07-15'))).toBe(5000)
  })
  it('includes the deadline day itself (register BY Aug 1)', () => {
    expect(resolvePriceCents(BASE, TIERS, at('2026-08-01'))).toBe(5000)
  })
  it('steps to the next tier after the first deadline passes', () => {
    expect(resolvePriceCents(BASE, TIERS, at('2026-08-15'))).toBe(6000)
  })
  it('falls back to the base fee once all tiers lapse', () => {
    expect(resolvePriceCents(BASE, TIERS, at('2026-09-15'))).toBe(7000)
  })
  it('returns the base fee when there are no tiers', () => {
    expect(resolvePriceCents(BASE, null, at('2026-07-15'))).toBe(7000)
    expect(resolvePriceCents(BASE, [], at('2026-07-15'))).toBe(7000)
  })
})

describe('activeTier', () => {
  it('returns the active tier, or null when lapsed', () => {
    expect(activeTier(TIERS, at('2026-07-15'))).toEqual({ until: '2026-08-01', cents: 5000 })
    expect(activeTier(TIERS, at('2026-09-15'))).toBeNull()
  })
})

describe('nextTierChange', () => {
  it('reports the next step up to the following tier', () => {
    expect(nextTierChange(BASE, TIERS, at('2026-07-15'))).toEqual({ afterUntil: '2026-08-01', cents: 6000 })
  })
  it('reports the final step up to the base fee', () => {
    expect(nextTierChange(BASE, TIERS, at('2026-08-15'))).toEqual({ afterUntil: '2026-09-01', cents: 7000 })
  })
  it('returns null once all tiers have lapsed', () => {
    expect(nextTierChange(BASE, TIERS, at('2026-09-15'))).toBeNull()
  })
})
