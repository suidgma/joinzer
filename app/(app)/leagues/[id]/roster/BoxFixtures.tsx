'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Match = { id: string; name1: string; name2: string; status: string; score1: number | null; score2: number | null }
export type BoxView = { id: string; name: string; matches: Match[] }

// Box matches: a round-robin within each box (generated from the seeded boxes).
// Scoring lands with PR-1.6; for now this is read-only + a (re-)generate action.
export default function BoxFixtures({ leagueId, boxes }: { leagueId: string; boxes: BoxView[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasFixtures = boxes.some(b => b.matches.length > 0)

  async function generate() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/boxes/generate`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error ?? 'Failed to generate'); return }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-5 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-brand-dark">Matches</h3>
          <p className="text-[11px] text-brand-muted">A round-robin within each box — everyone plays everyone in their box.</p>
        </div>
        <button
          onClick={generate}
          disabled={busy}
          className="shrink-0 px-3 py-2 rounded-lg bg-brand-dark text-white text-sm font-semibold hover:bg-brand-dark/90 disabled:opacity-50 transition-colors"
        >
          {busy ? 'Generating…' : hasFixtures ? 'Re-generate matches' : 'Generate matches'}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {!hasFixtures ? (
        <p className="text-xs text-brand-muted">No matches yet — generate the round-robin once your boxes look right.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {boxes.map(b => (
            <div key={b.id} className="bg-white rounded-xl border border-brand-border overflow-hidden">
              <div className="px-3 py-2 bg-brand-soft/40 border-b border-brand-border text-[11px] font-bold text-brand-dark uppercase tracking-wide">
                {b.name} · {b.matches.length} match{b.matches.length === 1 ? '' : 'es'}
              </div>
              <ul className="divide-y divide-brand-border/60">
                {b.matches.map(m => (
                  <li key={m.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <span className="flex-1 min-w-0 truncate text-brand-dark">
                      {m.name1} <span className="text-brand-muted">vs</span> {m.name2}
                    </span>
                    {m.status === 'completed' && m.score1 != null && (
                      <span className="shrink-0 font-bold text-brand-dark tabular-nums">{m.score1}–{m.score2}</span>
                    )}
                  </li>
                ))}
                {b.matches.length === 0 && (
                  <li className="px-3 py-2 text-xs text-brand-muted">No matches — box needs 2+ players.</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
