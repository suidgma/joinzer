'use client'

import { useState, useRef } from 'react'
import { GripVertical } from 'lucide-react'

type SeededReg = {
  id: string
  seed?: number | null
  status: string
  payment_status?: string | null
  team_name?: string | null
  registration_type?: 'team' | 'solo'
  partner_registration_id?: string | null
  user_profile: {
    name: string | null
    is_stub?: boolean
    dupr_rating?: number | null
    estimated_rating?: number | null
  } | null
  partner_profile?: {
    name: string | null
    dupr_rating?: number | null
    estimated_rating?: number | null
  } | null
}

type Props = {
  registrations: SeededReg[]
  isDoubles: boolean
  tournamentId: string
  divisionId: string
  onMarkComped: (regId: string) => void
  onRemove: (regId: string) => void
}

function lastName(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1]
}

function teamRating(reg: SeededReg, isDoubles: boolean): number | null {
  const r1 = reg.user_profile?.dupr_rating ?? reg.user_profile?.estimated_rating ?? null
  if (!isDoubles) return r1
  const r2 = reg.partner_profile?.dupr_rating ?? reg.partner_profile?.estimated_rating ?? null
  if (r1 != null && r2 != null) return (r1 + r2) / 2
  return r1 ?? r2
}

function teamName(reg: SeededReg, isDoubles: boolean): string {
  const p1 = reg.user_profile?.name
  if (!isDoubles) return p1 ?? '—'
  const p2 = reg.partner_profile?.name
  if (p2) return `${lastName(p1)} / ${lastName(p2)}`
  return lastName(p1)
}

function isConfirmed(reg: SeededReg) {
  return ['paid', 'waived', 'comped'].includes(reg.payment_status ?? '')
}

function paymentBadge(reg: SeededReg) {
  const p = reg.payment_status
  const classes =
    p === 'paid'     ? 'bg-green-100 text-green-700' :
    p === 'waived'   ? 'bg-gray-100 text-gray-500'   :
    p === 'comped'   ? 'bg-blue-50 text-blue-600'     :
    p === 'refunded' ? 'bg-purple-100 text-purple-700':
                       'bg-red-50 text-red-600'
  const label =
    p === 'paid'     ? '$ Paid'   :
    p === 'waived'   ? 'Waived'   :
    p === 'comped'   ? 'Comped'   :
    p === 'refunded' ? 'Refunded' :
                       '$ Unpaid'
  return <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${classes}`}>{label}</span>
}

export default function SeedingPanel({ registrations, isDoubles, tournamentId, divisionId, onMarkComped, onRemove }: Props) {
  const confirmed = registrations.filter(isConfirmed)
  const awaiting  = registrations.filter(r => !isConfirmed(r))

  const [order, setOrder] = useState<SeededReg[]>(() => {
    const withSeed = confirmed.filter(r => r.seed != null).sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0))
    const noSeed   = confirmed.filter(r => r.seed == null)
    return withSeed.length > 0 ? [...withSeed, ...noSeed] : [...confirmed]
  })

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dragIndex = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  function handleDragStart(i: number) { dragIndex.current = i }
  function handleDragOver(e: React.DragEvent, i: number) { e.preventDefault(); setDragOver(i) }
  function handleDrop(i: number) {
    const from = dragIndex.current
    if (from === null || from === i) { setDragOver(null); return }
    const next = [...order]
    const [moved] = next.splice(from, 1)
    next.splice(i, 0, moved)
    setOrder(next)
    setDragOver(null)
    setSaved(false)
  }
  function handleDragEnd() { dragIndex.current = null; setDragOver(null) }

  function autoSeed() {
    const sorted = [...order].sort((a, b) => {
      const ra = teamRating(a, isDoubles) ?? -Infinity
      const rb = teamRating(b, isDoubles) ?? -Infinity
      return rb - ra
    })
    setOrder(sorted)
    setSaved(false)
  }

  async function save() {
    setSaving(true); setError(null)
    try {
      const seeds = order.map((reg, i) => ({ id: reg.id, seed: i + 1 }))
      const res = await fetch(
        `/api/tournaments/${tournamentId}/divisions/${divisionId}/seeds`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seeds }) }
      )
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Save failed') }
      else setSaved(true)
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  const hasRatings = order.some(r => teamRating(r, isDoubles) != null)

  return (
    <div className="border border-brand-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-brand-border bg-brand-surface">
        <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">Seeding &amp; Registrants</p>
        <div className="flex items-center gap-2">
          {hasRatings && (
            <button onClick={autoSeed} className="text-xs text-brand-active hover:underline">
              Auto-seed by rating
            </button>
          )}
          {order.length > 0 && (
            <button
              onClick={save}
              disabled={saving}
              className="px-3 py-1 rounded-lg bg-brand text-brand-dark text-xs font-semibold hover:bg-brand/80 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Seeds'}
            </button>
          )}
        </div>
      </div>

      {error && <p className="px-3 py-1 text-xs text-red-600 bg-red-50">{error}</p>}

      {registrations.length === 0 ? (
        <p className="px-3 py-3 text-xs text-brand-muted">No registrants yet.</p>
      ) : (
        <ul className="divide-y divide-brand-border/60">
          {/* Confirmed registrants — draggable, seeded */}
          {order.map((reg, i) => {
            const rating = teamRating(reg, isDoubles)
            const canComp = reg.payment_status !== 'paid' && reg.payment_status !== 'refunded' && reg.payment_status !== 'comped'
            return (
              <li
                key={reg.id}
                draggable
                onDragStart={() => handleDragStart(i)}
                onDragOver={e => handleDragOver(e, i)}
                onDrop={() => handleDrop(i)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                  dragOver === i ? 'bg-brand-soft' : 'bg-white hover:bg-brand-soft/30'
                }`}
              >
                <GripVertical className="w-3.5 h-3.5 text-brand-muted shrink-0 cursor-grab active:cursor-grabbing" />
                <span className="w-5 text-[10px] font-bold text-brand-muted text-right shrink-0">{i + 1}</span>
                <span className="flex-1 font-medium text-brand-dark truncate">{teamName(reg, isDoubles)}</span>
                {reg.user_profile?.is_stub && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700">Invited</span>
                )}
                {paymentBadge(reg)}
                {rating != null && <span className="text-[10px] text-brand-muted shrink-0 w-8 text-right">{rating.toFixed(2)}</span>}
                <div className="flex shrink-0 items-center gap-2 ml-1">
                  {canComp && (
                    <button onClick={() => onMarkComped(reg.id)} className="text-brand-active hover:underline whitespace-nowrap">
                      Mark Comped
                    </button>
                  )}
                  <button onClick={() => onRemove(reg.id)} className="text-red-500 hover:underline">
                    Remove
                  </button>
                </div>
              </li>
            )
          })}

          {/* Awaiting payment — not seeded */}
          {awaiting.length > 0 && (
            <>
              <li className="px-3 py-1 bg-brand-surface">
                <div className="flex items-center gap-2">
                  <div className="flex-1 border-t border-brand-border/60" />
                  <span className="text-[10px] font-semibold text-brand-muted whitespace-nowrap">
                    Awaiting payment · {awaiting.length}
                  </span>
                  <div className="flex-1 border-t border-brand-border/60" />
                </div>
              </li>
              {awaiting.map(reg => {
                const canComp = reg.payment_status !== 'paid' && reg.payment_status !== 'refunded' && reg.payment_status !== 'comped'
                return (
                  <li key={reg.id} className="flex items-center gap-2 px-3 py-2 text-xs bg-white opacity-60">
                    <div className="w-3.5 shrink-0" />
                    <div className="w-5 shrink-0" />
                    <span className="flex-1 font-medium text-brand-dark truncate">{teamName(reg, isDoubles)}</span>
                    {reg.user_profile?.is_stub && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700">Invited</span>
                    )}
                    {paymentBadge(reg)}
                    <div className="flex shrink-0 items-center gap-2 ml-1">
                      {canComp && (
                        <button onClick={() => onMarkComped(reg.id)} className="text-brand-active hover:underline whitespace-nowrap">
                          Mark Comped
                        </button>
                      )}
                      <button onClick={() => onRemove(reg.id)} className="text-red-500 hover:underline">
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}
            </>
          )}
        </ul>
      )}

      <p className="px-3 py-1.5 text-[10px] text-brand-muted border-t border-brand-border/60 bg-brand-surface">
        Drag to reorder · Seed 1 gets the best bracket position · Seeds apply when you generate matches
      </p>
    </div>
  )
}
