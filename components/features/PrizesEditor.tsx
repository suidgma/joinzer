'use client'

import { Plus, X } from 'lucide-react'
import { PRIZE_TYPES, type Prize, type PrizeType } from '@/lib/prizes'

// Shared "Prizes & Awards" editor for the tournament / league / play create + edit forms.
// Repeatable rows: type (icon) + place + description. Emits a clean Prize[]; the parent
// stores it on the event's `prizes` jsonb column (send `prizes.length ? prizes : null`).
export default function PrizesEditor({
  value,
  onChange,
}: {
  value: Prize[]
  onChange: (next: Prize[]) => void
}) {
  const update = (i: number, patch: Partial<Prize>) =>
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const add = () =>
    onChange([...value, { place: value.length === 0 ? '1st Place' : '', description: '', type: 'trophy' }])

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium text-brand-dark">
          🏆 Prizes &amp; Awards <span className="text-brand-muted font-normal">(optional)</span>
        </p>
        <p className="text-xs text-brand-muted">
          Show players what they can win. Advertised only — you hand out prizes yourself.
        </p>
      </div>

      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((r, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <select
                value={r.type}
                onChange={(e) => update(i, { type: e.target.value as PrizeType })}
                aria-label="Prize type"
                className="shrink-0 rounded-lg border border-brand-border bg-white px-2 py-1.5 text-sm"
              >
                {PRIZE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.icon} {t.label}
                  </option>
                ))}
              </select>
              <input
                value={r.place}
                onChange={(e) => update(i, { place: e.target.value })}
                placeholder="1st Place"
                aria-label="Placement"
                className="w-24 shrink-0 rounded-lg border border-brand-border px-2.5 py-1.5 text-sm"
              />
              <input
                value={r.description}
                onChange={(e) => update(i, { description: e.target.value })}
                placeholder="$500 cash + trophy"
                aria-label="Prize"
                className="min-w-0 flex-1 rounded-lg border border-brand-border px-2.5 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove prize"
                className="mt-1.5 shrink-0 text-brand-muted/60 hover:text-red-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-active hover:text-brand-dark transition-colors"
      >
        <Plus className="w-3.5 h-3.5" /> Add prize
      </button>
    </div>
  )
}
