'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { PlayerScorableFixture } from '@/lib/leagues/playerFixtures'

// Player-facing score entry for their own box/ladder matches, shown when the league has
// "Allow players to submit scores" on. Saves directly via the shared fixture score route
// (the organizer can still edit). From the player's perspective: "I won / They won".
export default function PlayerFixtureScores({
  leagueId, fixtures, pointsToWin,
}: { leagueId: string; fixtures: PlayerScorableFixture[]; pointsToWin: number }) {
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(null)
  const [iWon, setIWon] = useState<boolean | null>(null)
  const [loser, setLoser] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (fixtures.length === 0) return null

  function toggle(f: PlayerScorableFixture) {
    setError(null)
    if (openId === f.id) { setOpenId(null); return }
    setOpenId(f.id)
    const done = f.myScore != null && f.oppScore != null
    setIWon(done ? f.myScore! > f.oppScore! : null)
    setLoser(done ? String(Math.min(f.myScore!, f.oppScore!)) : '')
  }

  async function save(f: PlayerScorableFixture) {
    if (iWon == null) { setError('Pick who won'); return }
    const l = parseInt(loser)
    if (isNaN(l) || l < 0 || l >= pointsToWin) { setError(`Loser score must be 0–${pointsToWin - 1}`); return }
    const myScore = iWon ? pointsToWin : l
    const oppScore = iWon ? l : pointsToWin
    const team_1_score = f.mySide === 1 ? myScore : oppScore
    const team_2_score = f.mySide === 1 ? oppScore : myScore
    setSavingId(f.id); setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/fixtures/${f.id}/score`, {
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
      <p className="text-xs text-brand-muted">Enter the score for your own matches — the organizer can edit if needed.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="bg-brand-surface border border-brand-border rounded-2xl divide-y divide-brand-border overflow-hidden">
        {fixtures.map((f) => {
          const done = f.myScore != null && f.oppScore != null
          const isOpen = openId === f.id
          return (
            <div key={f.id} className="px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  {f.round != null && (
                    <p className="text-[10px] text-brand-muted uppercase font-semibold">Round {f.round}{f.court ? ` · Court ${f.court}` : ''}</p>
                  )}
                  <p className="text-brand-dark truncate">vs {f.oppLabel}</p>
                </div>
                {done && !isOpen && <span className="font-bold text-brand-dark tabular-nums shrink-0">{f.myScore}–{f.oppScore}</span>}
                <button onClick={() => toggle(f)} className="text-xs font-medium text-brand-active shrink-0">
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
                    <button onClick={() => save(f)} disabled={savingId === f.id} className="ml-auto text-xs font-semibold bg-brand text-brand-dark px-3 py-1.5 rounded-lg disabled:opacity-50">
                      {savingId === f.id ? 'Saving…' : 'Save'}
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
