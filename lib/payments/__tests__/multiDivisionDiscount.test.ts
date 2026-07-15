import { describe, it, expect } from 'vitest'
import { computeBundle, normalizeMultiDivisionDiscount, bundleCancelRefundCents, type MultiDivisionDiscount } from '../multiDivisionDiscount'

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

describe('bundleCancelRefundCents', () => {
  const off80 = pctAdd(80) // organizer offers 80% off each additional division

  it("the reported exploit: $100 + 20 (80% off) — cancelling either refunds only $20, not $60", () => {
    // Paid $120 for two $100 divisions. Whichever you cancel, you drop to one division
    // (no multi-discount), which is repriced to its full $100 → refund is $120 - $100.
    expect(bundleCancelRefundCents([10000, 10000], 10000, off80)).toBe(2000)
  })

  it('the last remaining division refunds its full price', () => {
    expect(bundleCancelRefundCents([10000], 10000, off80)).toBe(10000)
  })

  it('three equal divisions: cancelling one add-on refunds one add-on price', () => {
    // $100 + $20 + $20 = $140. Cancel one → remaining two = $120 → refund $20.
    expect(bundleCancelRefundCents([10000, 10000, 10000], 10000, off80)).toBe(2000)
  })

  it('unequal bases: cancelling the cheaper add-on refunds its discounted price', () => {
    // $100 (anchor) + $50 add-on at 80% off ($10) = $110. Cancel the $50 → keep {$100} → refund $10.
    expect(bundleCancelRefundCents([10000, 5000], 5000, off80)).toBe(1000)
  })

  it('unequal bases: cancelling the pricier anchor re-anchors on the other (no reverse exploit)', () => {
    // Same $110 bundle. Cancel the $100 → keep {$50} repriced to full $50 → refund $110 - $50 = $60.
    expect(bundleCancelRefundCents([10000, 5000], 10000, off80)).toBe(6000)
  })

  it('percent_order: dropping below min_divisions removes the discount from what remains', () => {
    // $100 + $100 at 15% off the order = $170. Cancel one → remaining $100 (no discount) → refund $70.
    expect(bundleCancelRefundCents([10000, 10000], 10000, { type: 'percent_order', value: 15, min_divisions: 2 })).toBe(7000)
  })

  it('no discount → refunds the cancelled division at full base', () => {
    expect(bundleCancelRefundCents([10000, 6000], 10000, null)).toBe(10000)
  })

  it('refunds telescope to the full amount paid regardless of cancel order', () => {
    // Two $100 divisions, paid $120. Cancel one ($20 refund) then the other ($100 refund) = $120.
    const first = bundleCancelRefundCents([10000, 10000], 10000, off80) // 2000
    const second = bundleCancelRefundCents([10000], 10000, off80)        // 10000
    expect(first + second).toBe(12000)
  })

  it('a stacked percent code: refunds the marginal value NET of the code (no over-refund)', () => {
    // 2×$100 at 20%-additional = $180 bundle; a 10% code = $162 paid.
    // Cancel one → keep {$100} repriced WITH the code ($90) → refund $162 − $90 = $72.
    expect(bundleCancelRefundCents([10000, 10000], 10000, pctAdd(20), { type: 'percent', value: 10 })).toBe(7200)
  })

  it('a stacked code telescopes to the coded total actually paid', () => {
    const code = { type: 'percent' as const, value: 10 }
    const first = bundleCancelRefundCents([10000, 10000], 10000, pctAdd(20), code) // 7200
    const second = bundleCancelRefundCents([10000], 10000, pctAdd(20), code)        // 9000
    expect(first + second).toBe(16200) // == $162 paid, not the pre-code $180
  })

  it('a flat code is reapplied (capped) to what remains', () => {
    // 2×$100 at 20%-additional = $180; a $30 flat code → $150 paid.
    // Cancel one → keep {$100}, flat $30 still applies (capped at $100) → $70 → refund $150 − $70 = $80.
    expect(bundleCancelRefundCents([10000, 10000], 10000, pctAdd(20), { type: 'flat', value: 3000 })).toBe(8000)
  })
})
