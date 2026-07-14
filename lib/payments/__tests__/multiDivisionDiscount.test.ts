import { describe, it, expect } from 'vitest'
import { computeBundle, normalizeMultiDivisionDiscount, type MultiDivisionDiscount } from '../multiDivisionDiscount'

const items = (...cents: number[]) => cents.map((c, i) => ({ divisionId: 'd' + i, baseCents: c }))
const pctAdd = (v: number, min = 2): MultiDivisionDiscount => ({ type: 'percent_additional', value: v, min_divisions: min })

describe('normalizeMultiDivisionDiscount', () => {
  it('accepts valid configs and defaults min_divisions to 2', () => {
    expect(normalizeMultiDivisionDiscount({ type: 'percent_additional', value: 20 }))
      .toEqual({ type: 'percent_additional', value: 20, min_divisions: 2 })
    expect(normalizeMultiDivisionDiscount({ type: 'flat_per_additional', value: 1000, min_divisions: 3 }))
      .toEqual({ type: 'flat_per_additional', value: 1000, min_divisions: 3 })
  })
  it('rejects off/malformed configs', () => {
    expect(normalizeMultiDivisionDiscount(null)).toBeNull()
    expect(normalizeMultiDivisionDiscount({ type: 'percent_additional', value: 0 })).toBeNull()
    expect(normalizeMultiDivisionDiscount({ type: 'nope', value: 10 })).toBeNull()
    expect(normalizeMultiDivisionDiscount({ value: 10 })).toBeNull()
  })
})

describe('computeBundle', () => {
  it('no discount → total equals subtotal, net equals base', () => {
    const r = computeBundle(items(5000, 6000), null)
    expect(r.subtotalCents).toBe(11000)
    expect(r.multiDivDiscountCents).toBe(0)
    expect(r.totalCents).toBe(11000)
    expect(r.items.map((i) => i.netCents)).toEqual([5000, 6000])
  })

  it('does not apply below min_divisions', () => {
    const r = computeBundle(items(5000), pctAdd(20))
    expect(r.multiDivDiscountCents).toBe(0)
    expect(r.totalCents).toBe(5000)
  })

  it('percent_additional: full-price top division, rest discounted', () => {
    // $60 (full) + $50 at 20% off ($10) → discount $10, total $110
    const r = computeBundle(items(5000, 6000), pctAdd(20))
    expect(r.multiDivDiscountCents).toBe(1000)
    expect(r.totalCents).toBe(11000 - 1000)
  })

  it('percent_additional across 3 equal divisions', () => {
    // $50 (full) + two more at 20% off ($10 each) → $20 off, total $130
    const r = computeBundle(items(5000, 5000, 5000), pctAdd(20))
    expect(r.multiDivDiscountCents).toBe(2000)
    expect(r.totalCents).toBe(13000)
  })

  it('flat_per_additional caps at subtotal', () => {
    const r = computeBundle(items(5000, 5000, 5000), { type: 'flat_per_additional', value: 1000, min_divisions: 2 })
    expect(r.multiDivDiscountCents).toBe(2000) // (3-1) * $10
    expect(r.totalCents).toBe(13000)
  })

  it('percent_order discounts the whole order', () => {
    const r = computeBundle(items(5000, 5000), { type: 'percent_order', value: 15, min_divisions: 2 })
    expect(r.multiDivDiscountCents).toBe(1500)
    expect(r.totalCents).toBe(8500)
  })

  it('a discount code stacks after the bundle discount', () => {
    const r = computeBundle(items(5000, 5000), pctAdd(20), 500)
    // subtotal 10000, bundle -1000 → 9000, code -500 → 8500
    expect(r.multiDivDiscountCents).toBe(1000)
    expect(r.codeDiscountCents).toBe(500)
    expect(r.totalCents).toBe(8500)
  })

  it('allocates the total across items to the exact cent', () => {
    // Uneven split with a remainder — nets must sum to total.
    const r = computeBundle(items(3333, 3333, 3334), { type: 'percent_order', value: 10, min_divisions: 2 })
    const sum = r.items.reduce((s, i) => s + i.netCents, 0)
    expect(sum).toBe(r.totalCents)
    expect(r.items.every((i) => i.netCents >= 0)).toBe(true)
  })

  it('handles a free division in the bundle', () => {
    const r = computeBundle(items(0, 5000), pctAdd(20))
    // additional (the $0) discount = 0; total 5000
    expect(r.totalCents).toBe(5000)
    expect(r.items.reduce((s, i) => s + i.netCents, 0)).toBe(5000)
  })
})
