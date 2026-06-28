'use client'

import { useState } from 'react'
import { useDialog } from '@/components/ui/DialogProvider'
import Link from 'next/link'
import { formatSessionDate, formatTimeValue } from '@/lib/utils/date'

type SessionRow = {
  id: string
  session_number: number
  session_date: string
  session_time: string | null
  league_session_subs: { user_id: string; profile: { id: string; name: string } }[]
}

type Props = {
  leagueId: string
  sessions: SessionRow[]
}

export default function SessionManager({ leagueId, sessions: initialSessions }: Props) {
  const [sessions, setSessions] = useState<SessionRow[]>(initialSessions)
  const { alert } = useDialog()
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingDate, setEditingDate] = useState('')
  const [editingTime, setEditingTime] = useState('')
  const [savingSessionId, setSavingSessionId] = useState<string | null>(null)

  function startEditSession(session: SessionRow) {
    setEditingSessionId(session.id)
    setEditingDate(session.session_date)
    // Postgres returns "HH:MM:SS" — strip seconds for the time input
    setEditingTime(session.session_time ? session.session_time.slice(0, 5) : '')
  }

  async function handleSaveSession(sessionId: string) {
    setSavingSessionId(sessionId)
    try {
      const res = await fetch(`/api/league-sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_date: editingDate,
          session_time: editingTime || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        await alert({ body: err.error ?? 'Failed to save session' })
        return
      }
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? { ...s, session_date: editingDate, session_time: editingTime || null }
            : s
        )
      )
      setEditingSessionId(null)
    } finally {
      setSavingSessionId(null)
    }
  }

  if (sessions.length === 0) return null

  return (
    <section className="space-y-3 pt-6 border-t border-brand-border mt-6">
      <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">
        Manage Play
      </h2>

      {sessions.map((s) => {
        const subs = s.league_session_subs ?? []
        const dateStr = formatSessionDate(s.session_date)
        const timeStr = s.session_time ? formatTimeValue(s.session_time) : null
        const isOpen = editingSessionId === s.id

        return (
          <div key={s.id} className="bg-brand-surface border border-brand-border rounded-xl overflow-hidden">
            <button
              onClick={() => (isOpen ? setEditingSessionId(null) : startEditSession(s))}
              className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-brand-soft transition-colors"
            >
              <p className="text-sm font-medium text-brand-dark">
                Session {s.session_number} · {dateStr}{timeStr ? ` · ${timeStr}` : ''}
              </p>
              <span className="text-xs text-brand-muted">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="border-t border-brand-border px-3 py-3 space-y-3">
                <Link
                  href={`/leagues/${leagueId}/sessions/${s.id}/live`}
                  className="block w-full text-center py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-bold hover:bg-brand-hover transition-colors"
                >
                  Open Play →
                </Link>

                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Date &amp; Time</p>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={editingDate}
                      onChange={(e) => setEditingDate(e.target.value)}
                      className="flex-1 text-sm border border-brand-border rounded-lg px-2 py-1.5 text-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-active"
                    />
                    <input
                      type="time"
                      value={editingTime}
                      onChange={(e) => setEditingTime(e.target.value)}
                      className="w-28 text-sm border border-brand-border rounded-lg px-2 py-1.5 text-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-active"
                    />
                    <button
                      onClick={() => handleSaveSession(s.id)}
                      disabled={savingSessionId === s.id}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-soft border border-brand text-brand-dark hover:bg-brand transition-colors disabled:opacity-40"
                    >
                      {savingSessionId === s.id ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Subs Available</p>
                  {subs.length === 0
                    ? <p className="text-xs text-brand-muted">No subs signed up for this date.</p>
                    : <p className="text-xs text-brand-muted">{subs.map((sb) => sb.profile.name).join(', ')}</p>
                  }
                </div>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
