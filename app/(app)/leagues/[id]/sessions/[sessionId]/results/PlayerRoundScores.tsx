'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type PlayerRoundMatch = {
  roundMatchId: string
  round: number
  court: number | null
  oppLabel: string
  mySide: 1 | 2
  myScore: number | null
  oppScore: number | null
}

// Player-facing score entry for a registered player's own round-robin matches, shown on
// the session results page when the league has "Allow players to submit scores" on. Posts
// to the RR player-score route (organizer can still edit). "I won / They won" perspective.
export default function PlayerRoundScores({
  leagueId, sessionId, matches, pointsToWin,
}: { leagueId: string; sessionId: string; matches: PlayerRoundMatch[]; pointsToWin: number }) {
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(null)
  const [iWon, setIWon] = useState<boolean | null>(null)
  const [loser, setLoser] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (matches.length === 0) return null

  function toggle(m: PlayerRoundMatch) {
    setError(null)
    if (openId === m.roundMatchId) { setOpenId(null); return }
    setOpenId(m.roundMatchId)
    const done = m.myScore != null && m.oppScore != null
    setIWon(done ? m.myScore! > m.oppScore! : null)
    setLoser(done ? String(Math.min(m.myScore!, m.oppScore!)) : '')
  }

  async function save(m: PlayerRoundMatch) {
    if (iWon == null) { setError('Pick who won'); return }
    const l = parseInt(loser)
    if (isNaN(l) || l < 0 || l >= pointsToWin) { setError(`Loser score must be 0–${pointsToWin - 1}`); return }
    const myScore = iWon ? pointsToWin : l
    const oppScore = iWon ? l : pointsToWin
    const team_1_score = m.mySide === 1 ? myScore : oppScore
    const team_2_score = m.mySide === 1 ? oppScore : myScore
    setSavingId(m.roundMatchId); setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/sessions/${sessionId}/player-score`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundMatchId: m.roundMatchId, team_1_score, team_2_score }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? 'Failed to save'); return }
      setOpenId(null)
      router.refresh()
    } finally { setSavingId(null) }
  }

  return (
    <section className="space-y-2">
      <h2 className="font-heading text-base font-bold text-brand-dark">Your matches</h2>
      <p className="text-xs text-brand-muted">Enter the score for your own matches — the organizer can edit if needed.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="bg-brand-surface border border-brand-border rounded-2xl divide-y divide-brand-border overflow-hidden">
        {matches.map((m) => {
          const done = m.myScore != null && m.oppScore != null
          const isOpen = openId === m.roundMatchId
          return (
            <div key={m.roundMatchId} className="px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-brand-muted uppercase font-semibold">Round {m.round}{m.court ? ` · Court ${m.court}` : ''}</p>
                  <p className="text-brand-dark truncate">vs {m.oppLabel}</p>
                </div>
                {done && !isOpen && <span className="font-bold text-brand-dark tabular-nums shrink-0">{m.myScore}–{m.oppScore}</span>}
                <button onClick={() => toggle(m)} className="text-xs font-medium text-brand-active shrink-0">
                  {isOpen ? 'Cancel' : done ? 'Edit' : 'Enter score'}
                </button>
              </div>
              {isOpen && (
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setIWon(true)} className={`p-2 rounded-lg border text-sm ${iWon === true ? 'border-brand bg-brand-soft font-semibold text-brand-dark' : 'border-brand-border text-brand-muted'}`}>I won</button>
                    <button onClick={() => setIWon(false)} className={`p-2 rounded-lg border text-sm ${iWon === false ? 'border-brand bg-brand-soft font-semibold text-brand-dark' : 'border-brand-border text-brand-muted'}`}>They won</button>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-brand-muted">Loser score</label>
                    <input type="number" min="0" max={pointsToWin - 1} value={loser} onChange={(e) => setLoser(e.target.value)} className="input w-20 text-sm" placeholder="0" />
                    <span className="text-xs text-brand-muted">winner {pointsToWin}</span>
                    <button onClick={() => save(m)} disabled={savingId === m.roundMatchId} className="ml-auto text-xs font-semibold bg-brand text-brand-dark px-3 py-1.5 rounded-lg disabled:opacity-50">
                      {savingId === m.roundMatchId ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
