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
  const [searchQuery, setSearchQuery] = useState('')
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingDate, setEditingDate] = useState('')
  const [savingSessionId, setSavingSessionId] = useState<string | null>(null)

  const filteredPlayers = searchQuery.trim()
    ? availablePlayers.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 8)
    : []

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

  async function handleAdd(player: AvailablePlayer) {
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
      setSearchQuery('')
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
        <div className="pt-2 space-y-2">
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Add Player</p>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name…"
            className="w-full px-3 py-2 text-sm border border-brand-border rounded-lg bg-brand-surface text-brand-dark placeholder:text-brand-muted focus:outline-none focus:ring-1 focus:ring-brand-active"
          />
          {filteredPlayers.length > 0 && (
            <div className="border border-brand-border rounded-lg overflow-hidden divide-y divide-brand-border">
              {filteredPlayers.map((player) => (
                <button
                  key={player.id}
                  onClick={() => handleAdd(player)}
                  disabled={addingId === player.id}
                  className="w-full text-left px-3 py-2 text-sm text-brand-dark hover:bg-brand-soft disabled:opacity-40 flex items-center justify-between"
                >
                  <span>{player.name}</span>
                  {addingId === player.id && <span className="text-xs text-brand-muted">Adding…</span>}
                </button>
              ))}
            </div>
          )}
          {searchQuery.trim() && filteredPlayers.length === 0 && (
            <p className="text-xs text-brand-muted">No matching players found.</p>
          )}
        </div>
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

      {/* Sessions with inline date editing */}
      {sessions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">
            Session Sub Availability
          </h2>
          {sessions.map((s) => {
            const subs = s.league_session_subs ?? []
            const dateStr = new Date(s.session_date + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric',
            })
            const isEditing = editingSessionId === s.id

            return (
              <div key={s.id} className="bg-brand-surface border border-brand-border rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  {isEditing ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="date"
                        value={editingDate}
                        onChange={(e) => setEditingDate(e.target.value)}
                        className="text-sm border border-brand-border rounded px-2 py-1 text-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-active"
                      />
                      <button
                        onClick={() => handleSaveSession(s.id)}
                        disabled={savingSessionId === s.id}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-active text-white disabled:opacity-40"
                      >
                        {savingSessionId === s.id ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditingSessionId(null)}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-brand-muted border border-brand-border"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-brand-dark">
                        Session {s.session_number} · {dateStr}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => startEditSession(s)}
                          className="text-xs text-brand-active underline underline-offset-2"
                        >
                          Edit date
                        </button>
                        <Link
                          href={`/compete/leagues/${leagueId}/sessions/${s.id}/live`}
                          className="text-xs text-brand-active underline underline-offset-2"
                        >
                          Live →
                        </Link>
                      </div>
                    </>
                  )}
                </div>
                {subs.length === 0
                  ? <p className="text-xs text-brand-muted">No subs available for this date.</p>
                  : <p className="text-xs text-brand-muted">{subs.map((sb) => sb.profile.name).join(', ')}</p>
                }
              </div>
            )
          })}
        </section>
      )}
    </main>
  )
}
