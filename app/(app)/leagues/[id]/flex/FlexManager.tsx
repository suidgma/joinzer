'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { FlexMatchView, FlexCounts } from '@/lib/leagues/flexView'

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    scheduled: { label: 'Not played', cls: 'bg-brand-soft text-brand-muted' },
    in_progress: { label: 'Awaiting confirm', cls: 'bg-amber-100 text-amber-700' },
    completed: { label: 'Final', cls: 'bg-green-100 text-green-700' },
    disputed: { label: 'Disputed', cls: 'bg-red-100 text-red-600' },
  }
  const s = map[status] ?? map.scheduled
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${s.cls}`}>{s.label}</span>
}

// Organizer hub for a Flex league: generate the grid, watch progress, resolve disputes.
export default function FlexManager({
  leagueId,
  matches,
  counts,
  entrantCount,
}: {
  leagueId: string
  matches: FlexMatchView[]
  counts: FlexCounts
  entrantCount: number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scores, setScores] = useState<Record<string, { a: string; b: string }>>({})

  const hasFixtures = counts.total > 0
  const disputes = matches.filter((m) => m.status === 'disputed')

  async function generate(force = false) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/flex/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }),
      })
      if (res.status === 409) {
        const j = await res.json().catch(() => ({}))
        if (confirm(`Regenerate and discard ${j.played ?? ''} played match${j.played === 1 ? '' : 'es'}?`)) return generate(true)
        return
      }
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? 'Failed to generate'); return }
      router.refresh()
    } catch { setError('Network error') } finally { setBusy(false) }
  }

  async function resolve(id: string) {
    const s = scores[id]
    if (!s || s.a === '' || s.b === '') { setError('Enter both scores'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/flex/fixtures/${id}/resolve`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_1_score: Number(s.a), team_2_score: Number(s.b) }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? 'Failed to resolve'); return }
      router.refresh()
    } catch { setError('Network error') } finally { setBusy(false) }
  }

  const setScore = (id: string, side: 'a' | 'b', v: string) =>
    setScores((p) => ({ ...p, [id]: { ...(p[id] ?? { a: '', b: '' }), [side]: v.replace(/[^0-9]/g, '') } }))

  const byRound = new Map<number | null, FlexMatchView[]>()
  for (const m of matches) { const k = m.round ?? null; if (!byRound.has(k)) byRound.set(k, []); byRound.get(k)!.push(m) }
  const rounds = [...byRound.entries()].sort((a, b) => (a[0] ?? Infinity) - (b[0] ?? Infinity))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-base font-bold text-brand-dark">Matches</h2>
          <p className="text-xs text-brand-muted">
            {hasFixtures
              ? `${counts.completed}/${counts.total} final · ${counts.pending} awaiting confirm · ${counts.disputed} disputed`
              : `${entrantCount} entrant${entrantCount === 1 ? '' : 's'} — generate the round-robin to begin.`}
          </p>
        </div>
        {entrantCount >= 2 && (
          <button onClick={() => generate(false)} disabled={busy}
            className="bg-brand text-brand-dark rounded-lg text-sm font-semibold px-3 py-2 hover:bg-brand-hover disabled:opacity-50 whitespace-nowrap shrink-0">
            {busy ? 'Working…' : hasFixtures ? 'Regenerate' : 'Generate matches'}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {entrantCount < 2 ? (
        <p className="text-sm text-brand-muted">Add at least 2 entrants (Roster) to generate the schedule.</p>
      ) : !hasFixtures ? (
        <p className="text-sm text-brand-muted">No matches yet — generate the round-robin above.</p>
      ) : (
        <>
          {disputes.length > 0 && (
            <div className="border border-red-200 bg-red-50/50 rounded-2xl p-3 space-y-2">
              <h3 className="text-sm font-bold text-red-700">Disputes to resolve</h3>
              {disputes.map((m) => (
                <div key={m.id} className="bg-white border border-brand-border rounded-xl p-2.5 space-y-2">
                  <div className="text-sm text-brand-dark">{m.side1Name} <span className="text-brand-muted">vs</span> {m.side2Name}</div>
                  <div className="flex items-center gap-2">
                    <input inputMode="numeric" value={scores[m.id]?.a ?? ''} onChange={(e) => setScore(m.id, 'a', e.target.value)} placeholder={m.side1Name} className="w-14 rounded-lg border border-brand-border px-2 py-1.5 text-sm text-center" aria-label={`${m.side1Name} score`} />
                    <span className="text-xs text-brand-muted">–</span>
                    <input inputMode="numeric" value={scores[m.id]?.b ?? ''} onChange={(e) => setScore(m.id, 'b', e.target.value)} placeholder={m.side2Name} className="w-14 rounded-lg border border-brand-border px-2 py-1.5 text-sm text-center" aria-label={`${m.side2Name} score`} />
                    <button onClick={() => resolve(m.id)} disabled={busy} className="ml-auto bg-brand text-brand-dark rounded-lg text-xs font-semibold px-3 py-1.5 hover:bg-brand-hover disabled:opacity-50">Resolve</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {rounds.map(([round, ms]) => (
              <div key={round ?? 'x'} className="border border-brand-border rounded-2xl overflow-hidden">
                <div className="px-4 py-2 bg-brand-soft border-b border-brand-border text-xs font-bold text-brand-dark uppercase tracking-wide">Round {round ?? '—'}</div>
                <div className="divide-y divide-brand-border">
                  {ms.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                      <span className={`flex-1 text-right truncate ${m.winner1 === true ? 'font-semibold text-brand-dark' : 'text-brand-dark'}`}>{m.side1Name}</span>
                      <span className="text-xs tabular-nums text-brand-muted min-w-[3rem] text-center">
                        {m.status === 'completed' || m.status === 'in_progress' ? `${m.team1Score ?? ''}–${m.team2Score ?? ''}` : 'vs'}
                      </span>
                      <span className={`flex-1 truncate ${m.winner1 === false ? 'font-semibold text-brand-dark' : 'text-brand-dark'}`}>{m.side2Name}</span>
                      <StatusBadge status={m.status} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
