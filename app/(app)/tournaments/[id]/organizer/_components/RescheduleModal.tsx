'use client'
import { useState } from 'react'
import { X } from 'lucide-react'
import type { OrgMatch } from './types'

type Props = {
  tournamentId: string
  match: OrgMatch
  onClose: () => void
  onSaved: (updated: OrgMatch) => void
  onError: (message: string) => void
}

// Convert an ISO timestamp to a "YYYY-MM-DDTHH:mm" string suitable for <input type="datetime-local">.
// Returns '' for null/invalid input.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function RescheduleModal({
  tournamentId, match, onClose, onSaved, onError,
}: Props) {
  const [court, setCourt] = useState<string>(
    match.court_number != null ? String(match.court_number) : ''
  )
  const [time, setTime] = useState<string>(isoToLocalInput(match.scheduled_time))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)

    // Build patch — explicit null clears the field, undefined leaves it untouched.
    const payload: { court_number?: number | null; scheduled_time?: string | null } = {}

    const trimmedCourt = court.trim()
    if (trimmedCourt === '') {
      payload.court_number = null
    } else {
      const n = Number(trimmedCourt)
      if (!Number.isInteger(n) || n < 1) {
        setError('Court must be a positive whole number')
        setSaving(false)
        return
      }
      payload.court_number = n
    }

    if (time.trim() === '') {
      payload.scheduled_time = null
    } else {
      const d = new Date(time)
      if (Number.isNaN(d.getTime())) {
        setError('Invalid time')
        setSaving(false)
        return
      }
      payload.scheduled_time = d.toISOString()
    }

    try {
      const res = await fetch(
        `/api/tournaments/${tournamentId}/matches/${match.id}/reschedule`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Failed to save')
        return
      }
      onSaved(json.match)
      onClose()
    } catch {
      setError('Network error — please try again')
      onError('Reschedule failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-end justify-center sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-4"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base font-bold text-brand-dark">
            Reschedule match #{match.match_number}
          </h2>
          <button onClick={onClose} className="p-1 text-brand-muted hover:text-brand-dark">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-brand-muted uppercase tracking-wide mb-1">
              Court
            </label>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={court}
              onChange={e => setCourt(e.target.value)}
              placeholder="e.g. 4"
              className="input w-full"
            />
            <p className="text-[11px] text-brand-muted mt-1">Leave blank to unassign</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-brand-muted uppercase tracking-wide mb-1">
              Start time
            </label>
            <input
              type="datetime-local"
              value={time}
              onChange={e => setTime(e.target.value)}
              className="input w-full"
            />
            <p className="text-[11px] text-brand-muted mt-1">Leave blank to clear scheduled time</p>
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 rounded-xl bg-brand text-brand-dark font-semibold text-sm hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
