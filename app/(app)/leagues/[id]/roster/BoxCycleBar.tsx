'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDialog } from '@/components/ui/DialogProvider'

// Cycle control for box leagues: shows the active cycle and closes it — promoting
// the top / relegating the bottom of each box into the next cycle's boxes.
export default function BoxCycleBar({
  leagueId, cycleNumber, canAdvance, incomplete,
}: { leagueId: string; cycleNumber: number; canAdvance: boolean; incomplete: number }) {
  const router = useRouter()
  const { confirm, alert } = useDialog()
  const [busy, setBusy] = useState(false)

  async function advance() {
    const ok = await confirm({
      title: `Finish Cycle ${cycleNumber}?`,
      body: incomplete > 0
        ? `${incomplete} match${incomplete === 1 ? '' : 'es'} still ${incomplete === 1 ? 'has' : 'have'} no score. Advancing closes this cycle using the current standings, promotes/relegates, and opens Cycle ${cycleNumber + 1}.`
        : `Closes this cycle, promotes the top and relegates the bottom of each box, and opens Cycle ${cycleNumber + 1}.`,
      confirmLabel: 'Advance',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/cycles/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: incomplete > 0 }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        await alert({ title: 'Could not advance', body: j.error === 'incomplete' ? 'Some matches have no score.' : (j.error ?? 'Failed') })
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  // Completion state: every box match is scored — i.e. everyone has played
  // everyone in their box. Shown prominently (regardless of who entered the
  // final score) so a player self-scoring the last match, or an organizer who
  // dismissed the on-score pop-up, still gets a clear "ready to advance" prompt.
  if (canAdvance && incomplete === 0) {
    return (
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-900">🎉 Cycle {cycleNumber} complete</p>
          <p className="text-xs text-emerald-700">
            Everyone has played everyone in their box. Advancing promotes the top and relegates the bottom of each box into Cycle {cycleNumber + 1}.
          </p>
        </div>
        <button
          onClick={advance}
          disabled={busy}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
        >
          {busy ? 'Advancing…' : 'Advance to next cycle →'}
        </button>
      </div>
    )
  }

  return (
    <div className="mb-4 flex items-center justify-between gap-3 bg-brand-soft/40 border border-brand-border rounded-xl px-3 py-2">
      <div>
        <span className="text-sm font-semibold text-brand-dark">Cycle {cycleNumber}</span>
        {incomplete > 0 && <span className="ml-2 text-[11px] text-amber-700">{incomplete} unscored</span>}
      </div>
      {canAdvance && (
        <button
          onClick={advance}
          disabled={busy}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
        >
          {busy ? 'Advancing…' : 'Advance to next cycle →'}
        </button>
      )}
    </div>
  )
}
