'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDialog } from '@/components/ui/DialogProvider'

type Match = { id: string; name1: string; name2: string; status: string; score1: number | null; score2: number | null }
export type BoxView = { id: string; name: string; matches: Match[] }

// Box matches: a round-robin within each box, with organizer score entry
// (winner + loser score; winner scores points-to-win). Standings land with 1.5.
export default function BoxFixtures({
  leagueId, boxes, pointsToWin, stale,
}: { leagueId: string; boxes: BoxView[]; pointsToWin: number; stale?: boolean }) {
  const router = useRouter()
  const { confirm } = useDialog()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Per-match scoring state
  const [scoringId, setScoringId] = useState<string | null>(null)
  const [winner, setWinner] = useState<1 | 2 | null>(null)
  const [loserScore, setLoserScore] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  const allMatches = boxes.flatMap(b => b.matches)
  const hasFixtures = allMatches.length > 0
  const completedCount = allMatches.filter(m => m.status === 'completed').length

  async function generate() {
    if (completedCount > 0) {
      const ok = await confirm({
        title: 'Re-generate matches?',
        body: `${completedCount} match${completedCount === 1 ? ' has' : 'es have'} entered scores. Re-generating deletes all matches and results for this cycle.`,
        confirmLabel: 'Re-generate',
        danger: true,
      })
      if (!ok) return
    }
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/boxes/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: completedCount > 0 }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error === 'completed_exists' ? 'Some matches have scores — confirm to replace.' : (j.error ?? 'Failed to generate')); return }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  function openScore(m: Match) {
    setScoringId(m.id)
    setError(null)
    if (m.status === 'completed' && m.score1 != null && m.score2 != null) {
      setWinner(m.score1 > m.score2 ? 1 : 2)
      setLoserScore(String(Math.min(m.score1, m.score2)))
    } else {
      setWinner(null)
      setLoserScore('')
    }
  }

  async function saveScore(m: Match) {
    if (winner == null) { setError('Pick a winner'); return }
    const loser = parseInt(loserScore)
    if (isNaN(loser) || loser < 0 || loser >= pointsToWin) { setError(`Loser score must be 0–${pointsToWin - 1}`); return }
    const team_1_score = winner === 1 ? pointsToWin : loser
    const team_2_score = winner === 2 ? pointsToWin : loser
    setSavingId(m.id); setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/fixtures/${m.id}/score`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_1_score, team_2_score }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error ?? 'Failed to save'); return }
      setScoringId(null)
      router.refresh()
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="mt-5 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-brand-dark">Matches</h3>
          <p className="text-[11px] text-brand-muted">A round-robin within each box — tap Score to enter a result.</p>
        </div>
        {/* Once results are in, re-generating would wipe them — hide it. Changing
            the boxes after scoring goes through re-seeding (which confirms). */}
        {completedCount === 0 && (
          <button
            onClick={generate}
            disabled={busy}
            className="shrink-0 px-3 py-2 rounded-lg bg-brand-dark text-white text-sm font-semibold hover:bg-brand-dark/90 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Generating…' : hasFixtures ? 'Re-generate matches' : 'Generate matches'}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {stale && hasFixtures && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠ These matches are from an older box setup. <span className="font-semibold">Save boxes</span> above, then re-generate.
        </p>
      )}

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
                {b.matches.map(m => {
                  const done = m.status === 'completed' && m.score1 != null
                  return (
                    <li key={m.id} className="text-xs">
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className="flex-1 min-w-0 truncate text-brand-dark">
                          {m.name1} <span className="text-brand-muted">vs</span> {m.name2}
                        </span>
                        {done && <span className="shrink-0 font-bold text-brand-dark tabular-nums">{m.score1}–{m.score2}</span>}
                        <button
                          onClick={() => (scoringId === m.id ? setScoringId(null) : openScore(m))}
                          className="shrink-0 text-brand-active font-medium hover:underline"
                        >
                          {scoringId === m.id ? 'Cancel' : done ? 'Edit' : 'Score'}
                        </button>
                      </div>
                      {scoringId === m.id && (
                        <div className="px-3 pb-2.5 pt-1 bg-brand-soft/30 space-y-2">
                          <div className="flex gap-2">
                            {([[1, m.name1], [2, m.name2]] as const).map(([w, nm]) => (
                              <button
                                key={w}
                                onClick={() => setWinner(w)}
                                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold truncate ${winner === w ? 'bg-brand text-brand-dark' : 'bg-white border border-brand-border text-brand-muted'}`}
                              >
                                {nm} wins
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-brand-muted">Loser score</span>
                            <input
                              type="number" min={0} max={pointsToWin - 1} value={loserScore}
                              onChange={e => setLoserScore(e.target.value)}
                              className="w-16 input text-xs py-0.5 px-1.5 text-center"
                              placeholder="0"
                            />
                            <span className="text-brand-muted">Winner {pointsToWin}</span>
                            <button
                              onClick={() => saveScore(m)}
                              disabled={savingId === m.id}
                              className="ml-auto px-3 py-1 rounded-lg bg-brand text-brand-dark text-xs font-semibold disabled:opacity-50"
                            >
                              {savingId === m.id ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
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
