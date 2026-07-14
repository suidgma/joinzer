// Early-bird / tiered pricing. A ladder of { until: 'YYYY-MM-DD', cents } — the
// price applies while the current date (Pacific, the app's canonical deadline
// zone) is on or before `until`. Once every tier lapses, the base fee (cost_cents
// / price_cents) is the full price. Stored as jsonb; nullable = no tiers.

export type PriceTier = { until: string; cents: number }

// Current date in Pacific as 'YYYY-MM-DD' — string-comparable with a tier's `until`.
function todayInPacific(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now)
}

// Coerce an unknown jsonb value into clean tiers, sorted ascending by `until`.
export function normalizeTiers(raw: unknown): PriceTier[] {
  if (!Array.isArray(raw)) return []
  const tiers: PriceTier[] = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue
    const until = (t as Record<string, unknown>).until
    const cents = (t as Record<string, unknown>).cents
    if (typeof until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(until) && typeof cents === 'number' && cents >= 0) {
      tiers.push({ until, cents: Math.round(cents) })
    }
  }
  return tiers.sort((a, b) => a.until.localeCompare(b.until))
}

// The tier active right now (earliest not-yet-lapsed tier), or null once all tiers
// have lapsed (→ full/base price).
export function activeTier(tiers: unknown, now: Date): PriceTier | null {
  const today = todayInPacific(now)
  for (const t of normalizeTiers(tiers)) {
    if (today <= t.until) return t
  }
  return null
}

// The price to charge right now: the active tier's price, else the base fee.
export function resolvePriceCents(baseCents: number, tiers: unknown, now: Date): number {
  return activeTier(tiers, now)?.cents ?? baseCents
}

// The next price step after the active tier — for telling players "price rises to
// $X after <date>". Returns null when there's no active tier (already full price)
// or no tiers at all.
export function nextTierChange(
  baseCents: number,
  tiers: unknown,
  now: Date,
): { afterUntil: string; cents: number } | null {
  const today = todayInPacific(now)
  const sorted = normalizeTiers(tiers)
  const activeIdx = sorted.findIndex((t) => today <= t.until)
  if (activeIdx === -1) return null
  const active = sorted[activeIdx]
  const next = sorted[activeIdx + 1]
  return { afterUntil: active.until, cents: next ? next.cents : baseCents }
}
