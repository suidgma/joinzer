'use client'
import { useState, useRef, useMemo } from 'react'
import { GripVertical, ArrowUp } from 'lucide-react'
import { distributeIntoBoxes } from '@/lib/leagues/boxAssignment'

export type SeededItem = { id: string; name: string; rating?: number | null; note?: string | null }

type Props = {
  items: SeededItem[]
  // When set, the organizer picks how many groups (boxes) and players auto-fill
  // evenly into that many, with a header per group. Omit for a plain ordered list.
  initialGroupCount?: number
  maxGroups?: number
  groupLabel?: (tierRank: number) => string
  saveLabel?: string
  // Start in the "unsaved" state — e.g. when the persisted boxes no longer match
  // this preview (players added/removed). Defaults to saved.
  initialSaved?: boolean
  onSave: (orderedIds: string[], groupCount: number) => Promise<void>
}

// Generalized seeded roster: drag-to-reorder + auto-seed by rating + save. For box
// leagues the organizer chooses the number of boxes and players auto-fill evenly;
// the saved order + count is persisted (as boxes). Format-agnostic so flex / ladder
// / team can reuse it later. See docs/phases/league-seeded-roster.md.
export default function SeededRoster({ items, initialGroupCount, maxGroups, groupLabel, saveLabel, initialSaved = true, onSave }: Props) {
  const grouping = initialGroupCount != null
  const [order, setOrder] = useState<SeededItem[]>(items)
  const [groupCount, setGroupCount] = useState(initialGroupCount ?? 1)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(initialSaved)
  const [error, setError] = useState<string | null>(null)

  const dragIndex = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  const hasRatings = order.some(i => i.rating != null)
  // Cap boxes so none can end up with a single player (a box needs 2+ to play).
  const maxBoxes = Math.max(1, Math.min(maxGroups ?? Math.floor(order.length / 2), Math.floor(order.length / 2) || 1))
  const boxCount = Math.min(Math.max(1, groupCount), maxBoxes)

  // Flat render rows with group headers, using the same distribution as save.
  const rows = useMemo(() => {
    const out: { item: SeededItem; index: number; groupStart?: string }[] = []
    if (!grouping) {
      order.forEach((item, index) => out.push({ item, index }))
      return out
    }
    const groups = distributeIntoBoxes(order.map(i => i.id), boxCount)
    const byId = new Map(order.map(i => [i.id, i]))
    let index = 0
    for (const g of groups) {
      g.members.forEach((m, j) => {
        out.push({
          item: byId.get(m.registrationId)!,
          index,
          groupStart: j === 0 ? (groupLabel ? groupLabel(g.tierRank) : `Group ${g.tierRank}`) + ` · ${g.members.length}` : undefined,
        })
        index++
      })
    }
    return out
  }, [order, grouping, boxCount, groupLabel])

  function handleDrop(to: number) {
    const from = dragIndex.current
    setDragOver(null)
    dragIndex.current = null
    if (from == null || from === to) return
    setOrder(prev => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    setSaved(false)
  }

  function autoSeed() {
    setOrder(prev => [...prev].sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity)))
    setSaved(false)
  }

  async function save() {
    setSaving(true); setError(null)
    try {
      await onSave(order.map(i => i.id), boxCount)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-brand-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-brand-border bg-brand-surface">
        <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">Seeding &amp; Boxes</p>
        <div className="flex items-center gap-3">
          {grouping && (
            <label className="flex items-center gap-1.5 text-xs text-brand-muted">
              Boxes
              <select
                value={boxCount}
                onChange={e => { setGroupCount(Number(e.target.value)); setSaved(false) }}
                className="input text-xs py-0.5 pl-2 pr-6"
              >
                {Array.from({ length: maxBoxes }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
          {hasRatings && (
            <button onClick={autoSeed} className="text-xs text-brand-active hover:underline">Auto-seed by rating</button>
          )}
          {saved ? (
            <span className="text-[10px] text-green-600 font-semibold">✓ Saved</span>
          ) : (
            <button
              onClick={save}
              disabled={saving || order.length < 2}
              className="px-3 py-1 rounded-lg bg-brand text-brand-dark text-xs font-semibold hover:bg-brand/80 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : (saveLabel ?? 'Save')}
            </button>
          )}
        </div>
      </div>

      {error && <p className="px-3 py-1 text-xs text-red-600 bg-red-50">{error}</p>}

      {order.length === 0 ? (
        <p className="px-3 py-3 text-xs text-brand-muted">No entrants yet.</p>
      ) : (
        <ul>
          {rows.map(({ item, index, groupStart }) => (
            <li key={item.id}>
              {groupStart && (
                <div className="px-3 py-1 bg-brand-soft/50 border-y border-brand-border/60 text-[10px] font-bold uppercase tracking-wider text-brand-dark">
                  {groupStart} players
                </div>
              )}
              <div
                draggable
                onDragStart={() => { dragIndex.current = index }}
                onDragOver={e => { e.preventDefault(); setDragOver(index) }}
                onDrop={() => handleDrop(index)}
                onDragEnd={() => { dragIndex.current = null; setDragOver(null) }}
                className={`flex items-center gap-2 px-3 py-2 text-xs border-b border-brand-border/40 transition-colors ${dragOver === index ? 'bg-brand-soft' : 'bg-white'} hover:bg-brand-soft/30`}
              >
                <GripVertical className="w-3.5 h-3.5 shrink-0 text-brand-muted cursor-grab active:cursor-grabbing" />
                <span className="w-5 text-[10px] font-bold text-brand-muted text-right shrink-0">{index + 1}</span>
                <span className="flex-1 min-w-0 truncate font-medium text-brand-dark">{item.name}</span>
                {item.note && <span className="shrink-0 text-[10px] text-brand-muted">{item.note}</span>}
                {item.rating != null && <span className="shrink-0 text-[10px] text-brand-muted w-8 text-right">{item.rating.toFixed(2)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {order.length > 1 && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-brand-muted">
          <ArrowUp className="w-3 h-3 shrink-0" /><span>Pick the number of boxes · drag to re-order · players fill boxes top-to-bottom · Save to apply</span>
        </div>
      )}
    </div>
  )
}
