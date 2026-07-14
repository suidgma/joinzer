'use client'

import { Plus, X } from 'lucide-react'
import type { PriceTier } from '@/lib/payments/priceTiers'

// Controlled editor for an early-bird price ladder: "register by <date> at $<price>".
// Works in cents (the stored unit); shows dollars. After the last date, the entity's
// base Entry fee is the full price.
export default function PriceTiersEditor({
  value,
  onChange,
}: {
  value: PriceTier[]
  onChange: (tiers: PriceTier[]) => void
}) {
  const update = (i: number, patch: Partial<PriceTier>) =>
    onChange(value.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
  const add = () => onChange([...value, { until: '', cents: 0 }])
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))

  return (
    <div className="space-y-2">
      {value.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs text-brand-muted whitespace-nowrap shrink-0">Register by</span>
          <input
            type="date"
            value={t.until}
            onChange={(e) => update(i, { until: e.target.value })}
            className="input text-sm py-1 flex-1 min-w-0"
          />
          <span className="text-xs text-brand-muted shrink-0">at</span>
          <div className="relative w-24 shrink-0">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-brand-muted text-xs">$</span>
            <input
              type="number"
              min="0"
              step="1"
              value={t.cents ? String(t.cents / 100) : ''}
              onChange={(e) => update(i, { cents: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : 0 })}
              placeholder="0"
              className="input text-sm py-1 pl-5 w-full"
            />
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-brand-muted hover:text-red-600 shrink-0"
            aria-label="Remove early-bird price"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1 text-xs font-semibold text-brand-active hover:underline"
      >
        <Plus className="w-3.5 h-3.5" /> Add early-bird price
      </button>
      {value.length > 0 && (
        <p className="text-[11px] text-brand-muted">
          Earliest date wins. After the last date, the Entry fee above is the full price.
        </p>
      )}
    </div>
  )
}
