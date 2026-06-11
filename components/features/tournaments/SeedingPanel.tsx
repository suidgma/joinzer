'use client'

import { useState, useRef } from 'react'
import { GripVertical } from 'lucide-react'

type SeededReg = {
  id: string
  seed?: number | null
  user_profile: {
    name: string | null
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

export default function SeedingPanel({ registrations, isDoubles, tournamentId, divisionId }: Props) {
  // Initialize order: use existing seed values if set, else preserve registration order
  const [order, setOrder] = useState<SeededReg[]>(() => {
    const withSeed = registrations.filter(r => r.seed != null)
    const noSeed = registrations.filter(r => r.seed == null)
    if (withSeed.length === 0) return [...registrations]
    return [
      ...withSeed.sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0)),
      ...noSeed,
    ]
  })

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Drag state
  const dragIndex = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  function handleDragStart(i: number) {
    dragIndex.current = i
  }

  function handleDragOver(e: React.DragEvent, i: number) {
    e.preventDefault()
    setDragOver(i)
  }

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

  function handleDragEnd() {
    dragIndex.current = null
    setDragOver(null)
  }

  function autoSeed() {
    const sorted = [...order].sort((a, b) => {
      const ra = teamRating(a, isDoubles) ?? -Infinity
      const rb = teamRating(b, isDoubles) ?? -Infinity
      return rb - ra // descending: highest rating = seed 1
    })
    setOrder(sorted)
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const seeds = order.map((reg, i) => ({ id: reg.id, seed: i + 1 }))
      const res = await fetch(
        `/api/tournaments/${tournamentId}/divisions/${divisionId}/seeds`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seeds }) }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Save failed')
      } else {
        setSaved(true)
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  const hasRatings = order.some(r => teamRating(r, isDoubles) != null)

  return (
    <div className="border border-brand-border rounded-xl p-3 space-y-2 bg-white">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">Seeding</p>
        <div className="flex items-center gap-2">
          {hasRatings && (
            <button
              onClick={autoSeed}
              className="text-xs text-brand-active hover:underline"
            >
              Auto-seed by rating
            </button>
          )}
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-1 rounded-lg bg-brand text-brand-dark text-xs font-semibold hover:bg-brand/80 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Seeds'}
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <p className="text-[10px] text-brand-muted">Drag to reorder. Seed 1 gets best bracket position. Seeds are applied when you generate matches.</p>

      <ol className="space-y-1">
        {order.map((reg, i) => {
          const rating = teamRating(reg, isDoubles)
          return (
            <li
              key={reg.id}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={e => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs cursor-grab active:cursor-grabbing transition-colors ${
                dragOver === i
                  ? 'border-brand-active bg-brand-soft'
                  : 'border-brand-border bg-white hover:bg-brand-soft/40'
              }`}
            >
              <GripVertical className="w-3 h-3 text-brand-muted shrink-0" />
              <span className="w-5 text-[10px] font-bold text-brand-muted text-right shrink-0">{i + 1}</span>
              <span className="flex-1 font-medium text-brand-dark truncate">{teamName(reg, isDoubles)}</span>
              {rating != null && (
                <span className="text-[10px] text-brand-muted shrink-0">{rating.toFixed(2)}</span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
