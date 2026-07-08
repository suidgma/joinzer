'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type ScoreLine = {
  id: string
  label: string
  discipline: 'singles' | 'doubles'
  team1Players: string[]
  team2Players: string[]
  team1Score: number | null
  team2Score: number | null
  status: string
}

// Per-line score entry for a team matchup. Each line has one winner; Save PATCHes all
// entered line scores at once and the server rolls them up to the parent matchup
// (line wins per team → winner_team_id, status completed once every line is scored).
export default function MatchupScorer({
  leagueId,
  matchupId,
  team1Name,
  team2Name,
  lines,
}: {
  leagueId: string
  matchupId: string
  team1Name: string
  team2Name: string
  lines: ScoreLine[]
}) {
  const router = useRouter()
  const [scores, setScores] = useState<Record<string, { t1: string; t2: string }>>(() =>
    Object.fromEntries(
      lines.map((l) => [l.id, { t1: l.team1Score?.toString() ?? '', t2: l.team2Score?.toString() ?? '' }]),
    ),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function setScore(id: string, side: 't1' | 't2', value: string) {
    setSaved(false)
    setScores((prev) => ({ ...prev, [id]: { ...prev[id], [side]: value.replace(/[^0-9]/g, '') } }))
  }

  // Running tally of the lines that currently have a valid (non-tie) winner entered.
  const tally = useMemo(() => {
    let t1 = 0
    let t2 = 0
    for (const l of lines) {
      const s = scores[l.id]
      if (!s || s.t1 === '' || s.t2 === '') continue
      const a = Number(s.t1)
      const b = Number(s.t2)
      if (a === b) continue
      if (a > b) t1++
      else t2++
    }
    return { t1, t2 }
  }, [scores, lines])

  async function save() {
    setBusy(true)
    setError(null)
    const payload = lines
      .map((l) => {
        const s = scores[l.id]
        if (!s || s.t1 === '' || s.t2 === '') return null
        return { id: l.id, team_1_score: Number(s.t1), team_2_score: Number(s.t2) }
      })
      .filter(Boolean)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/teams/matchups/${matchupId}/score`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: payload }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? 'Failed to save scores')
        return
      }
      setSaved(true)
      router.refresh()
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-bold text-brand-dark">Score</h2>
        <span className="text-sm font-semibold text-brand-dark tabular-nums">{tally.t1} – {tally.t2}</span>
      </div>

      <div className="space-y-2">
        {lines.map((l) => {
          const s = scores[l.id] ?? { t1: '', t2: '' }
          const a = s.t1 === '' ? null : Number(s.t1)
          const b = s.t2 === '' ? null : Number(s.t2)
          const t1Wins = a != null && b != null && a > b
          const t2Wins = a != null && b != null && b > a
          return (
            <div key={l.id} className="border border-brand-border rounded-2xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-brand-dark">{l.label}</span>
                <span className="text-[11px] text-brand-muted capitalize">{l.discipline}</span>
              </div>
              <div className="grid grid-cols-[1fr_auto_auto_auto_1fr] items-center gap-2">
                <span className={`text-sm truncate text-right ${t1Wins ? 'font-semibold text-brand-dark' : 'text-brand-dark'}`}>
                  {l.team1Players.join(' / ') || team1Name}
                </span>
                <input
                  inputMode="numeric"
                  value={s.t1}
                  onChange={(e) => setScore(l.id, 't1', e.target.value)}
                  className="w-12 rounded-lg border border-brand-border bg-white px-2 py-1.5 text-sm text-center text-brand-dark"
                  aria-label={`${l.label} — ${team1Name} score`}
                />
                <span className="text-xs text-brand-muted">–</span>
                <input
                  inputMode="numeric"
                  value={s.t2}
                  onChange={(e) => setScore(l.id, 't2', e.target.value)}
                  className="w-12 rounded-lg border border-brand-border bg-white px-2 py-1.5 text-sm text-center text-brand-dark"
                  aria-label={`${l.label} — ${team2Name} score`}
                />
                <span className={`text-sm truncate ${t2Wins ? 'font-semibold text-brand-dark' : 'text-brand-dark'}`}>
                  {l.team2Players.join(' / ') || team2Name}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {saved && !error && <p className="text-sm text-green-600">Scores saved.</p>}

      <button
        onClick={save}
        disabled={busy}
        className="bg-brand text-brand-dark rounded-lg text-sm font-semibold px-4 py-2 hover:bg-brand-hover disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save scores'}
      </button>
    </div>
  )
}
