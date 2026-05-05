'use client'

import { useState } from 'react'

type Status = 'planning_to_attend' | 'cannot_attend' | 'checked_in_present' | 'running_late' | 'not_responded'

const BUTTONS: { status: Status; label: string; active: string; inactive: string }[] = [
  { status: 'planning_to_attend', label: "I'm coming",    active: 'bg-brand text-brand-dark border-brand',                inactive: 'bg-brand-surface text-brand-muted border-brand-border hover:border-brand' },
  { status: 'checked_in_present', label: "I'm here",      active: 'bg-brand-dark text-white border-brand-dark',          inactive: 'bg-brand-surface text-brand-muted border-brand-border hover:border-brand-dark' },
  { status: 'running_late',       label: "I'm running late",  active: 'bg-yellow-100 text-yellow-800 border-yellow-300',     inactive: 'bg-brand-surface text-brand-muted border-brand-border hover:border-yellow-300' },
  { status: 'cannot_attend',      label: "I can't make it",   active: 'bg-red-50 text-red-700 border-red-300',               inactive: 'bg-brand-surface text-brand-muted border-brand-border hover:border-red-300' },
]

type Props = {
  sessionId: string
  leagueId: string
  initialStatus: Status
  showSubRequest?: boolean
  leagueSkillLevel?: string | null
}

export default function PlayerCheckIn({ sessionId, leagueId, initialStatus, showSubRequest = true, leagueSkillLevel }: Props) {
  const [status, setStatus]           = useState<Status>(initialStatus)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [subRequested, setSubRequested] = useState(false)
  const [subLoading, setSubLoading]   = useState(false)
  const [subError, setSubError]       = useState<string | null>(null)

  async function handleStatusChange(newStatus: Status) {
    if (newStatus === status) return
    setSaving(true)
    setError(null)

    const res = await fetch(`/api/league-sessions/${sessionId}/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attendance_status: newStatus }),
    })

    if (!res.ok) {
      const d = await res.json()
      setError(d.error ?? 'Failed to update')
      setSaving(false)
      return
    }

    setStatus(newStatus)
    setSaving(false)
  }

  async function handleRequestSub() {
    setSubLoading(true)
    setSubError(null)

    // First ensure attendance is set to cannot_attend
    if (status !== 'cannot_attend') {
      await handleStatusChange('cannot_attend')
    }

    const res = await fetch('/api/league-sub-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        league_id: leagueId,
        league_session_id: sessionId,
        requested_skill_level: leagueSkillLevel ?? null,
      }),
    })

    const d = await res.json()
    if (!res.ok) {
      // 409 = already requested, treat as success
      if (res.status !== 409) { setSubError(d.error ?? 'Failed to create sub request'); setSubLoading(false); return }
    }

    setSubRequested(true)
    setSubLoading(false)
  }

  return (
    <div className="space-y-2 pt-2 border-t border-brand-border mt-2">
      <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">My status</p>

      <div className="grid grid-cols-2 gap-1.5">
        {BUTTONS.map(({ status: s, label, active, inactive }) => (
          <button
            key={s}
            onClick={() => handleStatusChange(s)}
            disabled={saving}
            className={`py-2 rounded-xl border text-xs font-semibold transition-colors disabled:opacity-50 ${status === s ? active : inactive}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* Sub request */}
      {showSubRequest && status === 'cannot_attend' && !subRequested && (
        <button
          onClick={handleRequestSub}
          disabled={subLoading}
          className="w-full py-2 rounded-xl border border-orange-300 bg-orange-50 text-orange-700 text-xs font-semibold hover:bg-orange-100 transition-colors disabled:opacity-50"
        >
          {subLoading ? 'Requesting…' : 'Need a sub? →'}
        </button>
      )}

      {subRequested && (
        <p className="text-xs text-brand-active font-medium">
          ✓ Sub request sent. Your organizer has been notified.
        </p>
      )}

      {subError && <p className="text-xs text-red-600">{subError}</p>}
    </div>
  )
}
