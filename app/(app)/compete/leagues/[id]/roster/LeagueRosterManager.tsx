'use client'

import { useState } from 'react'
import Link from 'next/link'

type PlayerReg = {
  status: string
  registered_at: string
  profile: {
    id: string
    name: string
    profile_photo_url: string | null
    dupr_rating: number | null
    estimated_rating: number | null
    rating_source: string | null
  }
}

type SubEntry = {
  created_at: string
  profile: { id: string; name: string; profile_photo_url: string | null }
}

type SessionRow = {
  id: string
  session_number: number
  session_date: string
  league_session_subs: { user_id: string; profile: { id: string; name: string } }[]
}

type AvailablePlayer = { id: string; name: string }

type Props = {
  leagueId: string
  leagueName: string
  maxPlayers: number | null
  registered: PlayerReg[]
  waitlisted: PlayerReg[]
  subInterest: SubEntry[]
  sessions: SessionRow[]
  availablePlayers: AvailablePlayer[]
}

function ratingStr(p: { rating_source: string | null; dupr_rating: number | null; estimated_rating: number | null }) {
  if (p.rating_source === 'dupr_known' && p.dupr_rating) return `DUPR ${p.dupr_rating}`
  if (p.rating_source === 'estimated' && p.estimated_rating) return `~${p.estimated_rating}`
  return '—'
}

export default function LeagueRosterManager({
  leagueId,
  leagueName,
  maxPlayers,
  registered: initialRegistered,
  waitlisted,
  subInterest,
  sessions: initialSessions,
  availablePlayers: initialAvailable,
}: Props) {
  const [registered, setRegistered] = useState<PlayerReg[]>(initialRegistered)
  const [availablePlayers, setAvailablePlayers] = useState<AvailablePlayer[]>(initialAvailable)
  const [sessions, setSessions] = useState<SessionRow[]>(initialSessions)
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingDate, setEditingDate] = useState('')
  const [savingSessionId, setSavingSessionId] = useState<string | null>(null)

  async function handleRemove(userId: string) {
    setRemovingId(userId)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/members/${userId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json()
        alert(err.error ?? 'Failed to remove player')
        return
      }
      const removed = registered.find((r) => r.profile.id === userId)
      setRegistered((prev) => prev.filter((r) => r.profile.id !== userId))
      if (removed) {
        setAvailablePlayers((prev) =>
          [...prev, { id: removed.profile.id, name: removed.profile.name }].sort((a, b) =>
            a.name.localeCompare(b.name)
          )
        )
      }
    } finally {
      setRemovingId(null)
    }
  }

  async function handleAdd() {
    const player = availablePlayers.find((p) => p.id === selectedPlayerId)
    if (!player) return
    setAddingId(player.id)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: player.id }),
      })
      if (!res.ok) {
        const err = await res.json()
        alert(err.error ?? 'Failed to add player')
        return
      }
      const newReg: PlayerReg = {
        status: 'registered',
        registered_at: new Date().toISOString(),
        profile: {
          id: player.id,
          name: player.name,
          profile_photo_url: null,
          dupr_rating: null,
          estimated_rating: null,
          rating_source: null,
        },
      }
      setRegistered((prev) => [...prev, newReg])
      setAvailablePlayers((prev) => prev.filter((p) => p.id !== player.id))
      setSelectedPlayerId('')
    } finally {
      setAddingId(null)
    }
  }

  function startEditSession(session: SessionRow) {
    setEditingSessionId(session.id)
    setEditingDate(session.session_date)
  }

  async function handleSaveSession(sessionId: string) {
    setSavingSessionId(sessionId)
    try {
      const res = await fetch(`/api/league-sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_date: editingDate }),
      })
      if (!res.ok) {
        const err = await res.json()
        alert(err.error ?? 'Failed to save session date')
        return
      }
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, session_date: editingDate } : s))
      )
      setEditingSessionId(null)
    } finally {
      setSavingSessionId(null)
    }
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-6">
      <div className="flex items-center gap-2">
        <Link href={`/compete/leagues/${leagueId}`} className="text-brand-muted text-sm">
          ← {leagueName}
        </Link>
      </div>

      <h1 className="font-heading text-xl font-bold text-brand-dark">Roster & Subs</h1>

      {/* Registered */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">
          Registered ({registered.length}{maxPlayers ? ` / ${maxPlayers}` : ''})
        </h2>
        {registered.length === 0 ? (
          <p className="text-sm text-brand-muted">No registered players yet.</p>
        ) : (
          <div className="space-y-1">
            {registered.map((r, i) => {
              const p = r.profile
              return (
                <div key={p.id} className="flex items-center gap-3 bg-brand-surface border border-brand-border rounded-xl px-3 py-2">
                  <span className="text-xs text-brand-muted w-5 text-right">{i + 1}</span>
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-brand-soft border border-brand-border flex-shrink-0">
                    {p.profile_photo_url
                      ? <img src={p.profile_photo_url} alt={p.name} className="w-full h-full object-cover" />
                      : <span className="flex items-center justify-center w-full h-full text-brand-muted text-xs">{p.name[0]}</span>
                    }
                  </div>
                  <span className="flex-1 text-sm font-medium text-brand-dark">{p.name}</span>
                  <span className="text-xs text-brand-muted">{ratingStr(p)}</span>
                  <button
                    onClick={() => handleRemove(p.id)}
                    disabled={removingId === p.id}
                    className="px-2 py-1 rounded text-xs text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40"
                  >
                    {removingId === p.id ? '…' : 'Remove'}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Add Player */}
        {availablePlayers.length > 0 && (
          <div className="pt-2 space-y-2">
            <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Add Player</p>
            <div className="flex gap-2">
              <select
                value={selectedPlayerId}
                onChange={(e) => setSelectedPlayerId(e.target.value)}
                className="flex-1 input text-sm"
              >
                <option value="">— Select a player —</option>
                {availablePlayers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                onClick={handleAdd}
                disabled={!selectedPlayerId || !!addingId}
                className="px-4 py-2 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-40 transition-colors"
              >
                {addingId ? '…' : 'Add'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Waitlist */}
      {waitlisted.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">
            Waitlist ({waitlisted.length})
          </h2>
          <div className="space-y-1">
            {waitlisted.map((r, i) => {
              const p = r.profile
              return (
                <div key={p.id} className="flex items-center gap-3 bg-brand-surface border border-yellow-200 rounded-xl px-3 py-2">
                  <span className="text-xs text-brand-muted w-5 text-right">{i + 1}</span>
                  <span className="flex-1 text-sm text-brand-dark">{p.name}</span>
                  <span className="text-xs text-yellow-700 font-medium">Waitlist</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Sub interest */}
      {subInterest.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">
            Sub Interest ({subInterest.length})
          </h2>
          <div className="space-y-1">
            {subInterest.map((s, i) => {
              const p = s.profile
              return (
                <div key={i} className="flex items-center gap-3 bg-brand-surface border border-brand-border rounded-xl px-3 py-2">
                  <span className="text-xs text-brand-muted w-5 text-right">{i + 1}</span>
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-brand-soft border border-brand-border flex-shrink-0">
                    {p.profile_photo_url
                      ? <img src={p.profile_photo_url} alt={p.name} className="w-full h-full object-cover" />
                      : <span className="flex items-center justify-center w-full h-full text-brand-muted text-xs">{p.name[0]}</span>
                    }
                  </div>
                  <span className="flex-1 text-sm text-brand-dark">{p.name}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Sessions */}
      {sessions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">
            Manage Sessions
          </h2>
          {sessions.map((s) => {
            const subs = s.league_session_subs ?? []
            const dateStr = new Date(s.session_date + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric',
            })
            const isOpen = editingSessionId === s.id

            return (
              <div key={s.id} className="bg-brand-surface border border-brand-border rounded-xl overflow-hidden">
                {/* Row — click to open/close */}
                <button
                  onClick={() => isOpen ? setEditingSessionId(null) : startEditSession(s)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-brand-soft transition-colors"
                >
                  <p className="text-sm font-medium text-brand-dark">
                    Session {s.session_number} · {dateStr}
                  </p>
                  <span className="text-xs text-brand-muted">{isOpen ? '▲' : '▼'}</span>
                </button>

                {/* Expanded panel */}
                {isOpen && (
                  <div className="border-t border-brand-border px-3 py-3 space-y-3">
                    {/* Date editor */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Edit Date</p>
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={editingDate}
                          onChange={(e) => setEditingDate(e.target.value)}
                          className="flex-1 text-sm border border-brand-border rounded-lg px-2 py-1.5 text-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-active"
                        />
                        <button
                          onClick={() => handleSaveSession(s.id)}
                          disabled={savingSessionId === s.id}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand text-brand-dark hover:bg-brand-hover disabled:opacity-40"
                        >
                          {savingSessionId === s.id ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>

                    {/* Live session link */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Session Manager</p>
                      <Link
                        href={`/compete/leagues/${leagueId}/sessions/${s.id}/live`}
                        className="block w-full text-center py-2 rounded-xl bg-brand-soft border border-brand-border text-sm font-medium text-brand-active hover:bg-brand-surface transition-colors"
                      >
                        Open Live Session →
                      </Link>
                    </div>

                    {/* Subs */}
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
      )}
    </main>
  )
}
