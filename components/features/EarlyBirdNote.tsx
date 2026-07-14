import { activeTier, nextTierChange, normalizeTiers } from '@/lib/payments/priceTiers'

function fmtCents(c: number): string {
  return `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`
}
function fmtDate(d: string): string {
  const dt = new Date(d + 'T00:00:00')
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

// Player-facing early-bird note: the price right now + when it rises. Server-safe
// (pure helpers). Renders nothing when the entity has no price tiers.
export default function EarlyBirdNote({
  baseCents,
  tiers,
  className = '',
}: {
  baseCents: number
  tiers: unknown
  className?: string
}) {
  if (normalizeTiers(tiers).length === 0) return null
  const now = new Date()
  const active = activeTier(tiers, now)
  const next = nextTierChange(baseCents, tiers, now)
  const current = active ? active.cents : baseCents
  return (
    <div className={`bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs ${className}`}>
      <p className="font-semibold text-amber-900">
        {active ? '⏰ Early-bird pricing' : 'Standard pricing'} — {fmtCents(current)} now
      </p>
      {next && (
        <p className="text-amber-800 mt-0.5">
          Rises to {fmtCents(next.cents)} after {fmtDate(next.afterUntil)}.
        </p>
      )}
    </div>
  )
}
