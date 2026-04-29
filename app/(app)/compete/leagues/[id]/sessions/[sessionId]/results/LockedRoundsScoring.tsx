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
  matches: LockedMatch[]
}

export default function LockedRoundsScoring({ sessionId, matches }: Props) {
  const router = useRouter()
  const supabase = createClient()

  // score state keyed by roundMatchId
  const [scores, setScores] = useState<Record<string, { t1: string; t2: string }>>(() => {
    const init: Record<string, { t1: string; t2: string }> = {}
    for (const m of matches) {
      init[m.roundMatchId] = {
        t1: m.existingScore != null ? String(m.existingScore.team1Score) : '',
        t2: m.existingScore != null ? String(m.existingScore.team2Score) : '',
      }
    }
    return init
  })
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const m of matches) { if (m.existingScore != null) init[m.roundMatchId] = true }
    return init
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  async function saveMatch(m: LockedMatch) {
    const s = scores[m.roundMatchId]
    if (s.t1 === '' || s.t2 === '') {
      setErrors((prev) => ({ ...prev, [m.roundMatchId]: 'Both scores required' }))
      return
    }
    setErrors((prev) => ({ ...prev, [m.roundMatchId]: '' }))
    setSaving((prev) => ({ ...prev, [m.roundMatchId]: true }))

    const t1s = parseInt(s.t1)
    const t2s = parseInt(s.t2)
    const row = {
      session_id: sessionId,
      round_number: m.roundNumber,
      court_number: m.courtNumber,
      team1_player1_id: m.team1[0]?.userId ?? null,
      team1_player2_id: m.team1[1]?.userId ?? null,
      team2_player1_id: m.team2[0]?.userId ?? null,
      team2_player2_id: m.team2[1]?.userId ?? null,
      team1_score: t1s,
      team2_score: t2s,
    }

    const { error } = await supabase.from('league_matches').insert(row)
    if (error) {
      setErrors((prev) => ({ ...prev, [m.roundMatchId]: error.message }))
    } else {
      setSaved((prev) => ({ ...prev, [m.roundMatchId]: true }))
      router.refresh()
    }
    setSaving((prev) => ({ ...prev, [m.roundMatchId]: false }))
  }

  // Group by round
  const rounds = Array.from(new Set(matches.map((m) => m.roundNumber))).sort((a, b) => a - b)

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
              const isSaving = saving[m.roundMatchId]
              const err = errors[m.roundMatchId]
              return (
                <div key={m.roundMatchId} className={`bg-brand-surface border rounded-xl p-3 space-y-2 ${isSaved ? 'border-green-200' : 'border-brand-border'}`}>
                  <div className="flex items-center justify-between gap-1 text-xs text-brand-muted">
                    <span>{m.matchType === 'singles' ? 'Singles' : 'Doubles'}</span>
                    {m.courtNumber && <span>Court {m.courtNumber}</span>}
                    {isSaved && <span className="text-green-600 font-medium">✓ Saved</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Team 1 */}
                    <div className="flex-1 min-w-0">
                      {m.team1.map((p) => (
                        <p key={p.userId} className="text-sm font-medium text-brand-dark truncate">{p.name}</p>
                      ))}
                    </div>
                    {/* Scores */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <input
                        type="number"
                        min="0"
                        value={s.t1}
                        onChange={(e) => setScores((prev) => ({ ...prev, [m.roundMatchId]: { ...prev[m.roundMatchId], t1: e.target.value } }))}
                        placeholder="0"
                        className="w-12 input text-sm text-center"
                        disabled={isSaved}
                      />
                      <span className="text-brand-muted text-sm">–</span>
                      <input
                        type="number"
                        min="0"
                        value={s.t2}
                        onChange={(e) => setScores((prev) => ({ ...prev, [m.roundMatchId]: { ...prev[m.roundMatchId], t2: e.target.value } }))}
                        placeholder="0"
                        className="w-12 input text-sm text-center"
                        disabled={isSaved}
                      />
                    </div>
                    {/* Team 2 */}
                    <div className="flex-1 min-w-0 text-right">
                      {m.team2.map((p) => (
                        <p key={p.userId} className="text-sm font-medium text-brand-dark truncate">{p.name}</p>
                      ))}
                    </div>
                  </div>
                  {err && <p className="text-xs text-red-600">{err}</p>}
                  {!isSaved && (
                    <button
                      onClick={() => saveMatch(m)}
                      disabled={isSaving}
                      className="w-full py-1.5 rounded-lg bg-brand text-brand-dark text-xs font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
                    >
                      {isSaving ? 'Saving…' : 'Save Score'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </section>
  )
}
