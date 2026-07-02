'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDialog } from '@/components/ui/DialogProvider'

export type BoxMemberVM = { registrationId: string; name: string; rating: number | null }
export type BoxVM = { id: string; tierRank: number; name: string; members: BoxMemberVM[] }

type Props = {
  leagueId: string
  cycleActive: boolean
  boxes: BoxVM[]
}

export default function BoxManager({ leagueId, cycleActive, boxes }: Props) {
  const router = useRouter()
  const { confirm, alert } = useDialog()
  const [busy, setBusy] = useState(false)

  const hasBoxes = boxes.length > 0

  async function autoAssign() {
    if (hasBoxes) {
      const ok = await confirm({
        title: 'Re-assign boxes?',
        body: 'This rebuilds every box from current ratings and discards any manual moves for this cycle.',
        confirmLabel: 'Re-assign',
        danger: true,
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/boxes/auto-assign`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { await alert({ title: 'Could not assign', body: json.error ?? 'Failed' }); return }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function move(registrationId: string, toBoxId: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/boxes/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId, toBoxId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { await alert({ title: 'Could not move', body: json.error ?? 'Failed' }); return }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-brand-dark">Boxes</h2>
          <p className="text-xs text-brand-muted">
            Rating-tiered groups for this cycle. Box 1 is the top tier. Move players to fine-tune, then generate the schedule.
          </p>
        </div>
        <button
          onClick={autoAssign}
          disabled={busy}
          className="shrink-0 px-3 py-2 rounded-lg bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
        >
          {busy ? 'Working…' : hasBoxes ? 'Re-assign by rating' : 'Auto-assign by rating'}
        </button>
      </div>

      {!hasBoxes ? (
        <div className="bg-white rounded-xl border border-brand-border text-center py-12 px-4">
          <p className="text-2xl mb-2">📦</p>
          <p className="text-sm font-semibold text-brand-dark">
            {cycleActive ? 'No boxes yet' : 'No active cycle yet'}
          </p>
          <p className="text-xs text-brand-muted mt-1 max-w-xs mx-auto">
            Auto-assign seeds the roster into rating-tiered boxes and opens the cycle. You can move players afterward.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {boxes.map(box => (
            <div key={box.id} className="bg-white rounded-xl border border-brand-border overflow-hidden">
              <div className="px-3 py-2 bg-brand-soft/40 border-b border-brand-border flex items-center justify-between">
                <span className="text-xs font-bold text-brand-dark uppercase tracking-wide">{box.name}</span>
                <span className="text-[10px] text-brand-muted">{box.members.length} players</span>
              </div>
              <ul className="divide-y divide-brand-border/60">
                {box.members.map(m => (
                  <li key={m.registrationId} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="flex-1 min-w-0 truncate text-brand-dark">{m.name}</span>
                    {m.rating != null && (
                      <span className="shrink-0 text-[10px] text-brand-muted w-8 text-right">{m.rating.toFixed(2)}</span>
                    )}
                    <select
                      value={box.id}
                      disabled={busy || boxes.length < 2}
                      onChange={e => { if (e.target.value !== box.id) move(m.registrationId, e.target.value) }}
                      className="shrink-0 input text-xs py-0.5 px-1.5"
                      title="Move to box"
                    >
                      {boxes.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </li>
                ))}
                {box.members.length === 0 && (
                  <li className="px-3 py-2 text-xs text-brand-muted">Empty</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
