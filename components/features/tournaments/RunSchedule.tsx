'use client'

import { useState } from 'react'

type Match = {
  id: string
  match_stage?: string
  round_number?: number | null
  court_number?: number | null
  scheduled_time?: string | null
  team_1_registration_id?: string | null
  team_2_registration_id?: string | null
  status?: string
  [k: string]: unknown
}

// Format a stored ISO instant into the local wall-clock value a <input type="datetime-local">
// expects, and back. The organizer's device is set to the venue's timezone on the day, so a
// round-trip through local time is what they see and intend.
function isoToLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function localInputToIso(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
function timeLabel(iso?: string | null): string {
  if (!iso) return 'Unscheduled'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'Unscheduled'
  return d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}

// Run-mode reschedule: move a not-yet-completed match to a court/time. Applies locally through
// RunMode (store + outbox → PATCH /matches/[id]/reschedule, which is idempotent last-write-wins).
export default function RunSchedule({
  matches,
  teamName,
  onReschedule,
  readOnly = false,
}: {
  matches: Match[]
  teamName: (regId: string | null | undefined) => string
  onReschedule: (matchId: string, courtNumber: number | null, scheduledTime: string | null) => Promise<void>
  readOnly?: boolean
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [court, setCourt] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)

  const schedulable = matches
    .filter(m => m.status !== 'completed' && (m.team_1_registration_id || m.team_2_registration_id))
    .sort((a, b) => (a.scheduled_time ?? '').localeCompare(b.scheduled_time ?? ''))

  if (schedulable.length === 0) {
    return <p className="text-sm text-brand-muted px-1">No matches to reschedule.</p>
  }

  function startEdit(m: Match) {
    setEditing(m.id)
    setCourt(m.court_number != null ? String(m.court_number) : '')
    setTime(isoToLocalInput(m.scheduled_time))
  }

  async function save(m: Match) {
    setBusy(true)
    try {
      const courtNum = court.trim() === '' ? null : Number(court)
      await onReschedule(m.id, Number.isFinite(courtNum as number) ? (courtNum as number) : null, localInputToIso(time))
      setEditing(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {schedulable.map(m => {
        const label = `${teamName(m.team_1_registration_id)} vs ${teamName(m.team_2_registration_id)}`
        const isEditing = editing === m.id
        return (
          <div key={m.id} className="rounded-xl border border-brand-border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-brand-dark truncate">{label}</span>
              {!isEditing && !readOnly && (
                <button onClick={() => startEdit(m)} className="text-xs font-semibold text-brand-active hover:underline shrink-0">
                  Edit
                </button>
              )}
            </div>
            {!isEditing ? (
              <p className="text-xs text-brand-muted">
                {m.court_number != null ? `Court ${m.court_number}` : 'No court'} · {timeLabel(m.scheduled_time)}
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <label className="flex-1 text-[11px] font-semibold text-brand-muted">
                    Court
                    <input
                      type="number" inputMode="numeric" value={court} onChange={e => setCourt(e.target.value.replace(/\D/g, ''))}
                      className="mt-0.5 w-full rounded-lg border border-brand-border px-2 py-1.5 text-sm text-brand-dark"
                      placeholder="—"
                    />
                  </label>
                  <label className="flex-[2] text-[11px] font-semibold text-brand-muted">
                    Time
                    <input
                      type="datetime-local" value={time} onChange={e => setTime(e.target.value)}
                      className="mt-0.5 w-full rounded-lg border border-brand-border px-2 py-1.5 text-sm text-brand-dark"
                    />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => save(m)} disabled={busy}
                    className="flex-1 rounded-lg bg-brand text-brand-dark text-xs font-bold py-1.5 disabled:opacity-50">
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditing(null)} disabled={busy}
                    className="rounded-lg border border-brand-border text-brand-muted text-xs font-semibold px-3 py-1.5">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
