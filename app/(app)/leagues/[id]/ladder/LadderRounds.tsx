'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useDialog } from '@/components/ui/DialogProvider'

export type CourtMatch = { id: string; court: number; name1: string; name2: string; status: string; score1: number | null; score2: number | null }
export type RoundView = { round: number; courts: CourtMatch[]; byeName: string | null }
export type PreviewChange = { name: string; before: number; after: number; delta: number; wins: number; losses: number }

// King-of-the-court run surface: generate rounds, enter each court's result, then
// preview + finalize the ladder movement. Reuses the fixture score route.
export default function LadderRounds({
  leagueId,
  pointsToWin,
  roundsPerSession,
  rounds,
  preview,
  unscored,
}: {
  leagueId: string
  pointsToWin: number
  roundsPerSession: number
  rounds: RoundView[]
  preview: PreviewChange[] | null
  unscored: number
}) {
  const router = useRouter()
  const { confirm } = useDialog()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scoringId, setScoringId] = useState<string | null>(null)
  const [winner, setWinner] = useState<1 | 2 | null>(null)
  const [loserScore, setLoserScore] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  const latest = rounds[rounds.length - 1]
  const latestScored = latest ? latest.courts.every((c) => c.status === 'completed') : false
  const roundsPlayed = rounds.length
  const canGenerate = roundsPlayed === 0 || (latestScored && roundsPlayed < roundsPerSession)

  async function generate() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/ladder/round`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error ?? 'Failed to generate round'); return }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  function openScore(m: CourtMatch) {
    setScoringId(m.id); setError(null)
    if (m.status === 'completed' && m.score1 != null && m.score2 != null) {
      setWinner(m.score1 > m.score2 ? 1 : 2)
      setLoserScore(String(Math.min(m.score1, m.score2)))
    } else {
      setWinner(null); setLoserScore('')
    }
  }

  async function saveScore(m: CourtMatch) {
    if (winner == null) { setError('Pick a winner'); return }
    const loser = parseInt(loserScore)
    if (isNaN(loser) || loser < 0 || loser >= pointsToWin) { setError(`Loser score must be 0–${pointsToWin - 1}`); return }
    const team_1_score = winner === 1 ? pointsToWin : loser
    const team_2_score = winner === 2 ? pointsToWin : loser
    setSavingId(m.id); setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/fixtures/${m.id}/score`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team_1_score, team_2_score }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error ?? 'Failed to save'); return }
      setScoringId(null)
      router.refresh()
    } finally {
      setSavingId(null)
    }
  }

  async function finalize() {
    const ok = await confirm({
      title: 'End the day?',
      body: unscored > 0
        ? `${unscored} court${unscored === 1 ? '' : 's'} still unscored. End the day using the scores entered so far?`
        : 'Apply tonight’s results to the ladder. Players move up or down (capped), absent players hold their rank.',
      confirmLabel: 'End the day',
    })
    if (!ok) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/ladder/finalize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: unscored > 0 }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(j.error ?? 'Failed to finalize'); return }
      router.push(`/leagues/${leagueId}/standings`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-start justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 text-xs flex-shrink-0">✕</button>
        </div>
      )}

      {rounds.map((r) => (
        <div key={r.round} className="rounded-xl border border-brand-border overflow-hidden">
          <div className="px-3 py-1.5 bg-brand-soft border-b border-brand-border text-xs font-bold text-brand-dark uppercase tracking-wide">
            Round {r.round}
          </div>
          {r.courts.map((m) => {
            const done = m.status === 'completed' && m.score1 != null
            const isScoring = scoringId === m.id
            return (
              <div key={m.id} className="px-3 py-2 border-b border-brand-border last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] text-brand-muted font-semibold uppercase">Court {m.court}</p>
                    <p className="text-sm text-brand-dark truncate">
                      {m.name1} <span className="text-brand-muted">vs</span> {m.name2}
                    </p>
                  </div>
                  {done && !isScoring ? (
                    <button onClick={() => openScore(m)} className="text-xs font-semibold text-brand-dark whitespace-nowrap">
                      {m.score1}–{m.score2} <span className="text-brand-muted underline ml-1">edit</span>
                    </button>
                  ) : !isScoring ? (
                    <button onClick={() => openScore(m)} className="text-xs font-semibold text-brand-active bg-brand-soft border border-brand-border px-2 py-1 rounded-lg whitespace-nowrap">
                      Enter score
                    </button>
                  ) : null}
                </div>
                {isScoring && (
                  <div className="mt-2 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      {([1, 2] as const).map((w) => (
                        <button
                          key={w}
                          onClick={() => setWinner(w)}
                          className={`p-2 rounded-lg border text-sm ${winner === w ? 'border-brand bg-brand-soft font-semibold text-brand-dark' : 'border-brand-border text-brand-muted'}`}
                        >
                          {w === 1 ? m.name1 : m.name2} won
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-brand-muted">Loser score</label>
                      <input
                        type="number" min="0" max={pointsToWin - 1} value={loserScore}
                        onChange={(e) => setLoserScore(e.target.value)}
                        className="input w-20 text-sm" placeholder="0"
                      />
                      <span className="text-xs text-brand-muted">winner {pointsToWin}</span>
                      <div className="ml-auto flex gap-2">
                        <button onClick={() => setScoringId(null)} className="text-xs text-brand-muted px-2 py-1.5">Cancel</button>
                        <button onClick={() => saveScore(m)} disabled={savingId === m.id} className="text-xs font-semibold bg-brand text-brand-dark px-3 py-1.5 rounded-lg disabled:opacity-50">
                          {savingId === m.id ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {r.byeName && (
            <div className="px-3 py-1.5 bg-amber-50 text-[11px] text-amber-800 border-t border-amber-200">Bye: {r.byeName}</div>
          )}
        </div>
      ))}

      {canGenerate && (
        <button onClick={generate} disabled={busy} className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50">
          {busy ? 'Working…' : roundsPlayed === 0 ? 'Generate round 1' : `Generate round ${roundsPlayed + 1}`}
        </button>
      )}
      {roundsPlayed > 0 && !latestScored && (
        <p className="text-xs text-brand-muted text-center">Score every court to generate the next round.</p>
      )}

      {preview && roundsPlayed > 0 && (
        <div className="rounded-xl border border-brand-border overflow-hidden">
          <div className="px-3 py-1.5 bg-brand-soft border-b border-brand-border text-xs font-bold text-brand-dark uppercase tracking-wide">
            Ladder update preview
          </div>
          <div className="divide-y divide-brand-border">
            {preview.map((c) => (
              <div key={c.name + c.before} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                <span className="text-brand-dark truncate">#{c.after} {c.name}</span>
                <span className="flex items-center gap-2 text-xs text-brand-muted whitespace-nowrap">
                  <span>{c.wins}–{c.losses}</span>
                  {c.delta === 0 ? <span className="text-brand-muted">—</span>
                    : c.delta > 0 ? <span className="text-green-600 font-semibold">▲ {c.delta}</span>
                    : <span className="text-red-500 font-semibold">▼ {-c.delta}</span>}
                </span>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-brand-border">
            <button onClick={finalize} disabled={busy} className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50">
              {busy ? 'Updating…' : 'End the day'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
