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
  const [saved, setSaved] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const m of matches) { if (m.existingScore != null) init[m.roundMatchId] = true }
    return init
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [savingAll, setSavingAll] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const unsaved = matches.filter((m) => !saved[m.roundMatchId])
  const allSaved = unsaved.length === 0

  async function saveAll() {
    // Validate — flag any unsaved match missing scores
    const newErrors: Record<string, string> = {}
    for (const m of unsaved) {
      const s = scores[m.roundMatchId]
      if (s.t1 === '' || s.t2 === '') newErrors[m.roundMatchId] = 'Both scores required'
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors((prev) => ({ ...prev, ...newErrors }))
      return
    }
    setErrors({})
    setSaveError(null)
    setSavingAll(true)

    const rows = unsaved.map((m) => ({
      session_id: sessionId,
      round_number: m.roundNumber,
      court_number: m.courtNumber,
      team1_player1_id: m.team1[0]?.userId ?? null,
      team1_player2_id: m.team1[1]?.userId ?? null,
      team2_player1_id: m.team2[0]?.userId ?? null,
      team2_player2_id: m.team2[1]?.userId ?? null,
      team1_score: parseInt(scores[m.roundMatchId].t1),
      team2_score: parseInt(scores[m.roundMatchId].t2),
    }))

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
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={s.t1}
                        onChange={(e) => setScores((prev) => ({ ...prev, [m.roundMatchId]: { ...prev[m.roundMatchId], t1: e.target.value } }))}
                        placeholder="0"
                        className="w-16 input text-sm text-center"
                        disabled={isSaved}
                      />
                      <span className="text-brand-muted text-sm">–</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={s.t2}
                        onChange={(e) => setScores((prev) => ({ ...prev, [m.roundMatchId]: { ...prev[m.roundMatchId], t2: e.target.value } }))}
                        placeholder="0"
                        className="w-16 input text-sm text-center"
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
                </div>
              )
            })}
          </div>
        )
      })}

      {saveError && (
        <p className="text-sm text-red-600">{saveError}</p>
      )}

      {allSaved ? (
        <p className="text-sm text-center text-green-600 font-medium">✓ All scores saved</p>
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
