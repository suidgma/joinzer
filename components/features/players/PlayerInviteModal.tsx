'use client'

import { useState } from 'react'

type Session = {
  id: string
  title: string
  starts_at: string
  location_name: string
}

type Props = {
  player: {
    userId: string
    name: string
    photoUrl: string | null
    timeWindows: string[]
  }
  sessions: Session[]
  onClose: () => void
}

const TIME_LABELS: Record<string, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
}

export default function PlayerInviteModal({ player, sessions, onClose }: Props) {
  const [selectedEventId, setSelectedEventId] = useState(sessions[0]?.id ?? '')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const firstName = player.name.split(' ')[0]
  const windowLabel = player.timeWindows.map((w) => TIME_LABELS[w] ?? w).join(', ')

  async function handleSend() {
    if (!selectedEventId) return
    setLoading(true)
    setError(null)

    const res = await fetch('/api/invite-player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invitedUserId: player.userId, eventId: selectedEventId }),
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error ?? 'Failed to send invite')
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="w-full max-w-sm bg-brand-surface rounded-2xl p-5 space-y-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-bold text-brand-dark">Invite to session</h2>
          <button onClick={onClose} className="text-brand-muted text-xl leading-none">&times;</button>
        </div>

        {/* Player info */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full overflow-hidden bg-brand-soft border border-brand-border flex-shrink-0">
            {player.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={player.photoUrl} alt={firstName} className="w-full h-full object-cover" />
            ) : (
              <span className="flex items-center justify-center w-full h-full text-brand-muted">
                <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
              </span>
            )}
          </div>
          <div>
            <p className="font-medium text-brand-dark">{player.name}</p>
            <p className="text-xs text-brand-muted">Available: {windowLabel}</p>
          </div>
        </div>

        {sent ? (
          <div className="text-center space-y-1 py-2">
            <p className="text-sm font-medium text-brand-dark">Invite sent ✓</p>
            <p className="text-xs text-brand-muted">{firstName} will receive an email with the session details.</p>
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-brand-muted text-center py-2">
            You have no upcoming sessions to invite them to.{' '}
            <a href="/events/create" className="text-brand-active underline">Create one?</a>
          </p>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Select your session</label>
              <select
                value={selectedEventId}
                onChange={(e) => setSelectedEventId(e.target.value)}
                className="w-full input"
              >
                {sessions.map((s) => {
                  const date = new Date(s.starts_at).toLocaleDateString('en-US', {
                    timeZone: 'America/Los_Angeles',
                    weekday: 'short', month: 'short', day: 'numeric',
                  })
                  const time = new Date(s.starts_at).toLocaleTimeString('en-US', {
                    timeZone: 'America/Los_Angeles',
                    hour: 'numeric', minute: '2-digit',
                  })
                  return (
                    <option key={s.id} value={s.id}>
                      {s.title} — {date} {time}
                    </option>
                  )
                })}
              </select>
            </div>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <button
              onClick={handleSend}
              disabled={!selectedEventId || loading}
              className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
            >
              {loading ? 'Sending…' : `Invite ${firstName}`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
