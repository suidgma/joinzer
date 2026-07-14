'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { computeBundle, type MultiDivisionDiscount } from '@/lib/payments/multiDivisionDiscount'

export type BundleDivision = {
  id: string
  name: string
  baseCents: number
  schedule?: { date: string; start: string | null; end: string | null } | null
}

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`

function describeDiscount(d: MultiDivisionDiscount): string {
  if (d.type === 'percent_additional') return `${d.value}% off each division after your first`
  if (d.type === 'flat_per_additional') return `${fmt(d.value)} off each division after your first`
  return `${d.value}% off your whole order`
}

// Two divisions conflict when their assigned schedule blocks fall on the same date
// and their time windows overlap. Divisions with no assigned block can't be judged.
function conflicts(a: BundleDivision, b: BundleDivision): boolean {
  if (!a.schedule || !b.schedule || a.schedule.date !== b.schedule.date) return false
  const as = a.schedule.start ?? '00:00:00', ae = a.schedule.end ?? '23:59:59'
  const bs = b.schedule.start ?? '00:00:00', be = b.schedule.end ?? '23:59:59'
  return as < be && bs < ae
}

// Player-facing multi-division cross-sell: pick 2+ eligible divisions, see the bundle
// discount + total, and check out once. Additive — the per-division Register button is
// unchanged. Posts to the reserve-then-pay orders route.
export default function BundleRegisterPanel({
  tournamentId,
  discount,
  divisions,
}: {
  tournamentId: string
  discount: MultiDivisionDiscount
  divisions: BundleDivision[]
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const chosen = divisions.filter((d) => selected.has(d.id))
  const bundle = computeBundle(chosen.map((d) => ({ divisionId: d.id, baseCents: d.baseCents })), discount)

  const clashes: string[] = []
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      if (conflicts(chosen[i], chosen[j])) clashes.push(`${chosen[i].name} & ${chosen[j].name}`)
    }
  }

  async function register() {
    if (chosen.length < 2) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ division_ids: [...selected] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not start checkout')
        setLoading(false)
        return
      }
      if (data.free) {
        router.refresh()
        return
      }
      if (data.url) window.location.href = data.url
      else setLoading(false)
    } catch {
      setError('Network error — please try again')
      setLoading(false)
    }
  }

  return (
    <div className="bg-brand-soft/50 border border-brand-border rounded-2xl p-4 space-y-3">
      <div>
        <p className="text-sm font-bold text-brand-dark">💸 Enter multiple divisions &amp; save</p>
        <p className="text-xs text-brand-muted">{describeDiscount(discount)} — pick the divisions you want and pay once.</p>
      </div>

      <div className="space-y-1">
        {divisions.map((d) => (
          <label key={d.id} className="flex items-center gap-2 text-sm cursor-pointer py-0.5">
            <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} className="accent-brand w-4 h-4" />
            <span className="flex-1 text-brand-dark">{d.name}</span>
            <span className="text-brand-muted tabular-nums">{fmt(d.baseCents)}</span>
          </label>
        ))}
      </div>

      {clashes.length > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          ⚠ {clashes.join('; ')} are scheduled at the same time — you may not be able to play both.
        </p>
      )}

      {chosen.length >= 2 && (
        <div className="text-xs text-brand-muted space-y-0.5 border-t border-brand-border pt-2">
          <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{fmt(bundle.subtotalCents)}</span></div>
          <div className="flex justify-between text-brand-active"><span>Bundle discount</span><span className="tabular-nums">−{fmt(bundle.multiDivDiscountCents)}</span></div>
          <div className="flex justify-between font-semibold text-brand-dark text-sm"><span>Total</span><span className="tabular-nums">{fmt(bundle.totalCents)}</span></div>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        onClick={register}
        disabled={loading || chosen.length < 2}
        className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-bold hover:bg-brand-hover disabled:opacity-40 transition-colors"
      >
        {loading ? 'Starting checkout…' : chosen.length < 2 ? 'Select 2+ divisions to bundle' : `Register ${chosen.length} divisions — ${fmt(bundle.totalCents)}`}
      </button>
    </div>
  )
}
