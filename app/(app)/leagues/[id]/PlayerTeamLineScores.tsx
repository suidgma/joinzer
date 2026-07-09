'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PlayerTeamLine } from '@/lib/leagues/playerTeamLines'

// Player-facing score entry for a team-league player's own lines, shown when the league
// has "Allow players to submit scores" on. Posts to the team line player-score route,
// which rolls the result up to the parent matchup. Organizer can still edit.
export default function PlayerTeamLineScores({
  leagueId, lines, pointsToWin,
}: { leagueId: string; lines: PlayerTeamLine[]; pointsToWin: number }) {
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(null)
  const [iWon, setIWon] = useState<boolean | null>(null)
  const [loser, setLoser] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (lines.length === 0) return null

  function toggle(l: PlayerTeamLine) {
    setError(null)
    if (openId === l.lineId) { setOpenId(null); return }
    setOpenId(l.lineId)
    const done = l.myScore != null && l.oppScore != null
    setIWon(done ? l.myScore! > l.oppScore! : null)
    setLoser(done ? String(Math.min(l.myScore!, l.oppScore!)) : '')
  }

  async function save(l: PlayerTeamLine) {
    if (iWon == null) { setError('Pick who won'); return }
    const n = parseInt(loser)
    if (isNaN(n) || n < 0 || n >= pointsToWin) { setError(`Loser score must be 0–${pointsToWin - 1}`); return }
    const myScore = iWon ? pointsToWin : n
    const oppScore = iWon ? n : pointsToWin
    const team_1_score = l.mySide === 1 ? myScore : oppScore
    const team_2_score = l.mySide === 1 ? oppScore : myScore
    setSavingId(l.lineId); setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/teams/matchups/${l.matchupId}/lines/${l.lineId}/player-score`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_1_score, team_2_score }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error ?? 'Failed to save'); return }
      setOpenId(null)
      router.refresh()
    } finally { setSavingId(null) }
  }

  return (
    <section className="space-y-2">
      <h2 className="font-heading text-base font-bold text-brand-dark">Your matches</h2>
      <p className="text-xs text-brand-muted">Enter the score for your own line — the organizer can edit if needed.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="bg-brand-surface border border-brand-border rounded-2xl divide-y divide-brand-border overflow-hidden">
        {lines.map((l) => {
          const done = l.myScore != null && l.oppScore != null
          const isOpen = openId === l.lineId
          return (
            <div key={l.lineId} className="px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-brand-muted uppercase font-semibold">{l.lineLabel}</p>
                  <p className="text-brand-dark truncate">vs {l.oppLabel}</p>
                </div>
                {done && !isOpen && <span className="font-bold text-brand-dark tabular-nums shrink-0">{l.myScore}–{l.oppScore}</span>}
                <button onClick={() => toggle(l)} className="text-xs font-medium text-brand-active shrink-0">
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
                    <button onClick={() => save(l)} disabled={savingId === l.lineId} className="ml-auto text-xs font-semibold bg-brand text-brand-dark px-3 py-1.5 rounded-lg disabled:opacity-50">
                      {savingId === l.lineId ? 'Saving…' : 'Save'}
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
