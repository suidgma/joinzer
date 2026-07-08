'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type ScheduleMatchup = { id: string; team1: string; team2: string; status: string }
type ScheduleDay = { round: number; name: string; matchups: ScheduleMatchup[] }

export default function TeamSchedule({
  leagueId,
  schedule,
  teamCount,
}: {
  leagueId: string
  schedule: ScheduleDay[]
  teamCount: number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasSchedule = schedule.length > 0
  const canGenerate = teamCount >= 2

  async function generate() {
    if (hasSchedule && !confirm('Regenerate the schedule? This replaces all matchdays.')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/teams/schedule/generate`, { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? 'Failed to generate schedule')
        return
      }
      router.refresh()
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-base font-bold text-brand-dark">Schedule</h2>
          <p className="text-xs text-brand-muted">Round-robin matchdays — every team plays every other team once.</p>
        </div>
        {canGenerate && (
          <button
            onClick={generate}
            disabled={busy}
            className="bg-brand text-brand-dark rounded-lg text-sm font-semibold px-3 py-2 hover:bg-brand-hover disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {busy ? 'Working…' : hasSchedule ? 'Regenerate' : 'Generate schedule'}
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {!canGenerate ? (
        <p className="text-sm text-brand-muted">Add at least 2 teams to generate a schedule.</p>
      ) : !hasSchedule ? (
        <p className="text-sm text-brand-muted">No schedule yet — generate one above.</p>
      ) : (
        <div className="space-y-3">
          {schedule.map((day) => (
            <div key={day.round} className="border border-brand-border rounded-2xl overflow-hidden">
              <div className="px-4 py-2 bg-brand-soft border-b border-brand-border text-xs font-bold text-brand-dark uppercase tracking-wide">{day.name}</div>
              <div className="divide-y divide-brand-border">
                {day.matchups.length === 0 ? (
                  <p className="px-4 py-2 text-xs text-brand-muted">Bye round.</p>
                ) : (
                  day.matchups.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                      <span className="flex-1 text-right text-brand-dark truncate">{m.team1}</span>
                      <span className="text-xs text-brand-muted px-1 shrink-0">vs</span>
                      <span className="flex-1 text-brand-dark truncate">{m.team2}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
