// Multi-division bundle pricing (Phase 5a). Pure + deterministic.
//
// Given the per-division base prices (already tier-resolved) and the organizer's
// bundle-discount config, computes the order subtotal, the bundle discount, an
// optional stacked code discount, the final total, and each division's pro-rata
// share of that total (`netCents`) for receipts/accounting.
//
// NOTE ON REFUNDS: per-division cancels do NOT refund the stored `netCents` — a
// static split is exploitable (cancel a deeply-discounted add-on and you'd shrink
// what you paid for a division you keep). The cancel route instead uses
// `bundleCancelRefundCents` (below), which recomputes the bundle over the divisions
// that remain, so a cancel refunds only the *marginal* amount that division added.

export type BundleItem = { divisionId: string; baseCents: number }

export type MultiDivisionDiscount = {
  // percent_additional: every division after the most expensive gets `value`% off.
  // flat_per_additional: `value` cents off per division after the first.
  // percent_order:       `value`% off the whole order.
  type: 'percent_additional' | 'flat_per_additional' | 'percent_order'
  value: number
  min_divisions: number // discount applies only at this many divisions (>= 2)
}

export type BundleResult = {
  subtotalCents: number
  multiDivDiscountCents: number
  codeDiscountCents: number
  totalCents: number
  items: { divisionId: string; baseCents: number; netCents: number }[]
}

// Parse the jsonb config; null when absent/off/malformed.
export function normalizeMultiDivisionDiscount(raw: unknown): MultiDivisionDiscount | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const type = r.type
  const value = r.value
  if (
    (type === 'percent_additional' || type === 'flat_per_additional' || type === 'percent_order') &&
    typeof value === 'number' && value > 0
  ) {
    const min = typeof r.min_divisions === 'number' && r.min_divisions >= 2 ? Math.floor(r.min_divisions) : 2
    return { type, value, min_divisions: min }
  }
  return null
}

// Allocate `total` across items pro-rata by base price, in whole cents, remainder
// going to the largest fractional shares. Sum of netCents === total exactly.
function allocate(items: BundleItem[], total: number): BundleResult['items'] {
  const subtotal = items.reduce((s, i) => s + Math.max(0, i.baseCents), 0)
  if (subtotal <= 0 || total <= 0) {
    return items.map((i) => ({ divisionId: i.divisionId, baseCents: i.baseCents, netCents: 0 }))
  }
  const raw = items.map((i) => (Math.max(0, i.baseCents) / subtotal) * total)
  const net = raw.map(Math.floor)
  let remainder = total - net.reduce((a, b) => a + b, 0)
  const byFrac = raw
    .map((v, idx) => ({ idx, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  for (let k = 0; remainder > 0 && byFrac.length > 0; k++, remainder--) {
    net[byFrac[k % byFrac.length].idx]++
  }
  return items.map((i, idx) => ({ divisionId: i.divisionId, baseCents: i.baseCents, netCents: net[idx] }))
}

export function computeBundle(
  items: BundleItem[],
  discount: MultiDivisionDiscount | null | undefined,
  codeDiscountCents = 0,
): BundleResult {
  const subtotal = items.reduce((s, i) => s + Math.max(0, i.baseCents), 0)
  const n = items.length

  let multiDiv = 0
  if (discount && n >= discount.min_divisions) {
    if (discount.type === 'percent_additional') {
      // Most expensive division is full price; each of the rest gets value% off.
      const additional = [...items].sort((a, b) => b.baseCents - a.baseCents).slice(1)
      multiDiv = additional.reduce((s, i) => s + Math.round(Math.max(0, i.baseCents) * discount.value / 100), 0)
    } else if (discount.type === 'flat_per_additional') {
      multiDiv = (n - 1) * discount.value
    } else if (discount.type === 'percent_order') {
      multiDiv = Math.round(subtotal * discount.value / 100)
    }
  }
  multiDiv = Math.min(Math.max(0, multiDiv), subtotal)

  const afterBundle = subtotal - multiDiv
  const code = Math.min(Math.max(0, Math.round(codeDiscountCents)), afterBundle)
  const total = afterBundle - code

  return {
    subtotalCents: subtotal,
    multiDivDiscountCents: multiDiv,
    codeDiscountCents: code,
    totalCents: total,
    items: allocate(items, total),
  }
}

// The discount-code terms snapshotted on an order, so a refund reprices with the same code.
export type BundleDiscountCode = { type: 'percent' | 'flat'; value: number }

// Refund for cancelling ONE division out of a bundle: the marginal amount that
// division contributes at the bundle's current size, i.e.
//   bundleTotal(divisions still active) − bundleTotal(those minus the cancelled one).
// Recomputed (not the stored pro-rata `netCents`) so:
//   - cancelling a deeply-discounted add-on refunds only its discounted price, and
//   - dropping below `min_divisions` removes the discount from what remains, so a
//     kept division is always repriced to its fair standalone/marginal price.
// This closes the arbitrage in BOTH directions (cancel the add-on OR the anchor).
// When a discount code was applied, it's reapplied to both the before/after totals
// (percent = % of that subset's after-bundle amount; flat = capped at it) so a coded
// bundle refunds the marginal value NET of the code — never the pre-code amount.
// Only the payer's own bundled divisions go through here; partner "pay-for-both"
// seats are full-price standalone items and refund their own base.
export function bundleCancelRefundCents(
  activeBaseCentsBefore: number[], // base_cents of every still-active payer division in the order (incl. the one being cancelled)
  cancelledBaseCents: number,      // base_cents of the division being cancelled (one of the above)
  discount: MultiDivisionDiscount | null | undefined,
  code?: BundleDiscountCode | null,
): number {
  const totalFor = (cents: number[]): number => {
    const items: BundleItem[] = cents.map((c, i) => ({ divisionId: String(i), baseCents: c }))
    let codeCents = 0
    if (code && cents.length > 0) {
      const pre = computeBundle(items, discount)
      const afterBundle = pre.subtotalCents - pre.multiDivDiscountCents
      codeCents = code.type === 'percent'
        ? Math.round(afterBundle * code.value / 100)
        : Math.min(code.value, afterBundle)
    }
    return computeBundle(items, discount, codeCents).totalCents
  }
  const before = totalFor(activeBaseCentsBefore)
  const after = [...activeBaseCentsBefore]
  const idx = after.indexOf(cancelledBaseCents)
  if (idx >= 0) after.splice(idx, 1) // remove one matching base; identity doesn't matter, only the multiset
  return Math.max(0, before - totalFor(after))
}
