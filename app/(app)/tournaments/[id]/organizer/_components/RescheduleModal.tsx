'use client'
import { useState } from 'react'
import { X } from 'lucide-react'
import type { OrgMatch } from './types'

type Props = {
  tournamentId: string
  match: OrgMatch
  onClose: () => void
  onSaved: (updated: OrgMatch) => void
  onError: (msg: string) => void
}

export default function RescheduleModal({ tournamentId, match, onClose, onSaved, onError }: Props) {
  const [court, setCourt] = useState<string>(match.court_number != null ? String(match.court_number) : '')
  const [time, setTime] = useState<string>(
    match.scheduled_time
      ? new Date(match.scheduled_time).toLocaleTimeString('en-CA', {
          hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles',
        })
      : ''
  )
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {}
      if (court !== '') body.court_number = parseInt(court)
      else body.court_number = null

      if (time) {
        // Build a datetime from the match date + new time (using LA timezone)
        const matchDate = match.scheduled_time
          ? new Date(match.scheduled_time).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
          : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
        body.scheduled_time = `${matchDate}T${time}:00-07:00`
      } else {
        body.scheduled_time = null
      }

      const res = await fetch(
        `/api/tournaments/${tournamentId}/matches/${match.id}/reschedule`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      )
      const json = await res.json()
      if (!res.ok) { onError(json.error ?? 'Reschedule failed'); onClose(); return }
      onSaved(json.match as OrgMatch)
      onClose()
    } catch {
      onError('Network error')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-xs p-5 space-y-4"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-sm font-bold text-brand-dark">Reschedule Match #{match.match_number}</h2>
          <button onClick={onClose} className="p-1 text-brand-muted hover:text-brand-dark">
            <X size={16} />
          </button>
        </div>

        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1">Court Number</label>
          <input
            type="number"
            min={1}
            value={court}
            onChange={e => setCourt(e.target.value)}
            placeholder="None"
            className="w-full input"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1">Start Time</label>
          <input
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
            className="w-full input"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-brand-border text-sm text-brand-muted hover:bg-brand-soft transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
