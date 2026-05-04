'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export type LockedMatch = {
  roundMatchId: string
  roundNumber: number
  courtNumber: number | null
  matchType: 'doubles' | 'singles'
  team1: { userId: string; name: string }[]
  team2: { userId: string; name: string }[]
  existingScore: { team1Score: number; team2Score: number } | null
}

type Props = {
  sessionId: string
  leagueId: string
  matches: LockedMatch[]
  roundsPlanned: number
  pointsToWin: number
}

type ScoreEntry = { winner: '1' | '2' | ''; loserScore: string }

function initFromExisting(score: { team1Score: number; team2Score: number }): ScoreEntry {
  if (score.team1Score > score.team2Score) {
    return { winner: '1', loserScore: String(score.team2Score) }
  }
  return { winner: '2', loserScore: String(score.team1Score) }
}

export default function LockedRoundsScoring({ sessionId, leagueId, matches, roundsPlanned, pointsToWin }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [scores, setScores] = useState<Record<string, ScoreEntry>>(() => {
    const init: Record<string, ScoreEntry> = {}
    for (const m of matches) {
      init[m.roundMatchId] = m.existingScore != null
        ? initFromExisting(m.existingScore)
        : { winner: '', loserScore: '' }
    }
    return init
  })
  const [saved, setSaved] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const m of matches) { if (m.existingScore != null) init[m.roundMatchId] = true }
    return init
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [savingAll, setSavingAll] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)

  const unsaved = matches.filter((m) => !saved[m.roundMatchId])
  const allSaved = unsaved.length === 0

  function setWinner(id: string, winner: '1' | '2') {
    setScores((prev) => ({ ...prev, [id]: { ...prev[id], winner } }))
    setErrors((prev) => { const next = { ...prev }; delete next[id]; return next })
  }

  function setLoserScore(id: string, loserScore: string) {
    setScores((prev) => ({ ...prev, [id]: { ...prev[id], loserScore } }))
    setErrors((prev) => { const next = { ...prev }; delete next[id]; return next })
  }

  async function saveAll() {
    const newErrors: Record<string, string> = {}
    for (const m of unsaved) {
      const s = scores[m.roundMatchId]
      if (!s.winner) newErrors[m.roundMatchId] = 'Select a winner'
      else if (s.loserScore === '') newErrors[m.roundMatchId] = 'Enter loser score'
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors((prev) => ({ ...prev, ...newErrors }))
      return
    }
    setErrors({})
    setSaveError(null)
    setSavingAll(true)

    const rows = unsaved.map((m) => {
      const s = scores[m.roundMatchId]
      const loser = parseInt(s.loserScore)
      return {
        session_id: sessionId,
        round_number: m.roundNumber,
        court_number: m.courtNumber,
        team1_player1_id: m.team1[0]?.userId ?? null,
        team1_player2_id: m.team1[1]?.userId ?? null,
        team2_player1_id: m.team2[0]?.userId ?? null,
        team2_player2_id: m.team2[1]?.userId ?? null,
        team1_score: s.winner === '1' ? pointsToWin : loser,
        team2_score: s.winner === '2' ? pointsToWin : loser,
      }
    })

    const { error } = await supabase.from('league_matches').insert(rows)
    if (error) {
      setSaveError(error.message)
    } else {
      const nowSaved: Record<string, boolean> = {}
      for (const m of unsaved) nowSaved[m.roundMatchId] = true
      setSaved((prev) => ({ ...prev, ...nowSaved }))
      router.refresh()
    }
    setSavingAll(false)
  }

  async function generateNext(replaceExisting = false) {
    setGenerating(true)
    setGenerateError(null)
    const res = await fetch(`/api/league-sessions/${sessionId}/generate-next-round`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replace_existing_draft: replaceExisting }),
    })
    const data = await res.json()
    if (res.status === 409) {
      setGenerating(false)
      if (confirm('A draft round already exists. Replace it with a new one?')) {
        generateNext(true)
      }
      return
    }
    if (!res.ok) {
      setGenerateError(data.error ?? 'Failed to generate round')
      setGenerating(false)
      return
    }
    window.location.href = `/compete/leagues/${leagueId}/sessions/${sessionId}/live`
  }

  async function endDay() {
    if (!confirm('Mark this session as completed and end the day?')) return
    setGenerating(true)
    setGenerateError(null)
    const res = await fetch(`/api/league-sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    })
    if (!res.ok) {
      const d = await res.json()
      setGenerateError(d.error ?? 'Failed to end session')
      setGenerating(false)
      return
    }
    router.push(`/compete/leagues/${leagueId}/standings`)
  }

  const rounds = Array.from(new Set(matches.map((m) => m.roundNumber))).sort((a, b) => a - b)
  const maxRoundNumber = rounds.length > 0 ? Math.max(...rounds) : 0
  const isLastRound = maxRoundNumber >= roundsPlanned

  if (matches.length === 0) return null

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">
        From Scheduled Rounds
      </h2>
      {rounds.map((roundNum) => {
        const roundMatches = matches.filter((m) => m.roundNumber === roundNum)
        return (
          <div key={roundNum} className="space-y-2">
            <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Round {roundNum}</p>
            {roundMatches.map((m) => {
              const s = scores[m.roundMatchId]
              const isSaved = saved[m.roundMatchId]
              const err = errors[m.roundMatchId]
              const t1Won = s.winner === '1'
              const t2Won = s.winner === '2'
              const displayScore = s.winner && s.loserScore !== ''
                ? t1Won
                  ? `${pointsToWin} – ${s.loserScore}`
                  : `${s.loserScore} – ${pointsToWin}`
                : null

              return (
                <div key={m.roundMatchId} className={`bg-brand-surface border rounded-xl p-3 space-y-2 ${isSaved ? 'border-green-200' : 'border-brand-border'}`}>
                  <div className="flex items-center justify-between gap-1 text-xs text-brand-muted">
                    <span>{m.matchType === 'singles' ? 'Singles' : 'Doubles'}</span>
                    {m.courtNumber && <span>Court {m.courtNumber}</span>}
                    {isSaved && <span className="text-green-600 font-medium">✓ Saved</span>}
                  </div>

                  {/* Player names */}
                  <div className="flex items-start gap-2 text-sm">
                    <div className={`flex-1 min-w-0 ${t1Won ? 'font-semibold text-brand-dark' : 'text-brand-muted'}`}>
                      {m.team1.map((p) => <p key={p.userId} className="truncate">{p.name}</p>)}
                    </div>
                    <div className="flex-shrink-0 text-center text-xs text-brand-muted self-center px-1">vs</div>
                    <div className={`flex-1 min-w-0 text-right ${t2Won ? 'font-semibold text-brand-dark' : 'text-brand-muted'}`}>
                      {m.team2.map((p) => <p key={p.userId} className="truncate">{p.name}</p>)}
                    </div>
                  </div>

                  {/* Score entry */}
                  {isSaved ? (
                    <p className="text-center font-bold text-brand-dark text-sm">{displayScore}</p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setWinner(m.roundMatchId, '1')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${t1Won ? 'bg-brand text-brand-dark' : 'bg-brand-soft text-brand-muted hover:bg-brand-border'}`}
                      >
                        T1 Won
                      </button>
                      <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
                        <span className="text-[10px] text-brand-muted leading-none">Loser</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={s.loserScore}
                          onChange={(e) => setLoserScore(m.roundMatchId, e.target.value)}
                          placeholder="0"
                          className="w-14 input text-sm text-center"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setWinner(m.roundMatchId, '2')}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${t2Won ? 'bg-brand text-brand-dark' : 'bg-brand-soft text-brand-muted hover:bg-brand-border'}`}
                      >
                        T2 Won
                      </button>
                    </div>
                  )}

                  {displayScore && !isSaved && (
                    <p className="text-center text-xs text-brand-muted">Score: {displayScore}</p>
                  )}
                  {err && <p className="text-xs text-red-600">{err}</p>}
                </div>
              )
            })}
          </div>
        )
      })}

      {saveError && <p className="text-sm text-red-600">{saveError}</p>}

      {allSaved ? (
        <div className="space-y-2">
          <p className="text-sm text-center text-green-600 font-medium">✓ All scores saved</p>
          {generateError && <p className="text-sm text-red-600 text-center">{generateError}</p>}
          {isLastRound ? (
            <button
              onClick={endDay}
              disabled={generating}
              className="w-full py-3 rounded-xl bg-brand-dark text-white text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {generating ? 'Ending…' : '🏁 End the Day'}
            </button>
          ) : (
            <button
              onClick={() => generateNext()}
              disabled={generating}
              className="w-full py-3 rounded-xl bg-brand text-brand-dark text-sm font-bold hover:bg-brand-hover disabled:opacity-50 transition-colors"
            >
              {generating ? 'Generating…' : 'Generate Next Round →'}
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={saveAll}
          disabled={savingAll}
          className="w-full py-3 rounded-xl bg-brand text-brand-dark text-sm font-bold hover:bg-brand-hover disabled:opacity-50 transition-colors"
        >
          {savingAll ? 'Saving…' : `Save ${unsaved.length} Score${unsaved.length !== 1 ? 's' : ''}`}
        </button>
      )}
    </section>
  )
}
