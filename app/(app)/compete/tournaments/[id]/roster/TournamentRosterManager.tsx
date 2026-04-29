'use client'

import { useState } from 'react'
import Link from 'next/link'

type TournamentReg = {
  tournament_event_id: string
  status: string
  partner_name: string | null
  registered_at: string
  profile: { id: string; name: string; profile_photo_url: string | null }
}

type EventRow = {
  id: string
  name: string
  category: string
  skill_level: string | null
  max_teams: number | null
}

type AvailablePlayer = { id: string; name: string }

type Props = {
  tournamentId: string
  tournamentName: string
  events: EventRow[]
  regsByEvent: Record<string, TournamentReg[]>
  availablePlayers: AvailablePlayer[]
}

const CATEGORY_LABELS: Record<string, string> = {
  mens_singles: "Men's Singles",
  womens_singles: "Women's Singles",
  mens_doubles: "Men's Doubles",
  womens_doubles: "Women's Doubles",
  mixed_doubles: 'Mixed Doubles',
}

export default function TournamentRosterManager({
  tournamentId,
  tournamentName,
  events,
  regsByEvent: initialRegsByEvent,
  availablePlayers: initialAvailable,
}: Props) {
  const [regsByEvent, setRegsByEvent] = useState<Record<string, TournamentReg[]>>(initialRegsByEvent)
  const [availablePlayers, setAvailablePlayers] = useState<AvailablePlayer[]>(initialAvailable)
  const [searchByEvent, setSearchByEvent] = useState<Record<string, string>>({})
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)
  const [removingKey, setRemovingKey] = useState<string | null>(null)
  const [addingKey, setAddingKey] = useState<string | null>(null)

  function getSearch(eventId: string) {
    return searchByEvent[eventId] ?? ''
  }

  function setSearch(eventId: string, value: string) {
    setSearchByEvent((prev) => ({ ...prev, [eventId]: value }))
  }

  function filteredForEvent(eventId: string) {
    const query = getSearch(eventId).trim().toLowerCase()
    if (!query) return []
    return availablePlayers.filter((p) => p.name.toLowerCase().includes(query)).slice(0, 8)
  }

  async function handleRemove(eventId: string, userId: string) {
    const key = `${eventId}-${userId}`
    setRemovingKey(key)
    try {
      const res = await fetch(
        `/api/tournaments/${tournamentId}/members/${userId}?eventId=${eventId}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const err = await res.json()
        alert(err.error ?? 'Failed to remove player')
        return
      }
      const removedReg = (regsByEvent[eventId] ?? []).find((r) => r.profile.id === userId)
      setRegsByEvent((prev) => ({
        ...prev,
        [eventId]: (prev[eventId] ?? []).filter((r) => r.profile.id !== userId),
      }))
      // Add back to available if not in any other event
      if (removedReg) {
        const inOtherEvent = Object.entries(regsByEvent).some(
          ([eid, regs]) =>
            eid !== eventId &&
            regs.some((r) => r.profile.id === userId && r.status !== 'cancelled')
        )
        if (!inOtherEvent) {
          setAvailablePlayers((prev) =>
            [...prev, { id: removedReg.profile.id, name: removedReg.profile.name }].sort((a, b) =>
              a.name.localeCompare(b.name)
            )
          )
        }
      }
    } finally {
      setRemovingKey(null)
    }
  }

  async function handleAdd(eventId: string, player: AvailablePlayer) {
    const key = `${eventId}-${player.id}`
    setAddingKey(key)
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: player.id, eventId }),
      })
      if (!res.ok) {
        const err = await res.json()
        alert(err.error ?? 'Failed to add player')
        return
      }
      const newReg: TournamentReg = {
        tournament_event_id: eventId,
        status: 'registered',
        partner_name: null,
        registered_at: new Date().toISOString(),
        profile: { id: player.id, name: player.name, profile_photo_url: null },
      }
      setRegsByEvent((prev) => ({
        ...prev,
        [eventId]: [...(prev[eventId] ?? []), newReg],
      }))
      setSearch(eventId, '')
    } finally {
      setAddingKey(null)
    }
  }

  if (events.length === 0) {
    return (
      <main className="max-w-lg mx-auto p-4 space-y-6">
        <Link href={`/compete/tournaments/${tournamentId}`} className="text-brand-muted text-sm">
          ← {tournamentName}
        </Link>
        <p className="text-sm text-brand-muted">No events added yet.</p>
      </main>
    )
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-6">
      <div className="flex items-center gap-2">
        <Link href={`/compete/tournaments/${tournamentId}`} className="text-brand-muted text-sm">
          ← {tournamentName}
        </Link>
      </div>

      <h1 className="font-heading text-xl font-bold text-brand-dark">Tournament Roster</h1>

      <div className="space-y-6">
        {events.map((evt) => {
          const regs = regsByEvent[evt.id] ?? []
          const registeredRegs = regs.filter((r) => r.status === 'registered')
          const waitlistedRegs = regs.filter((r) => r.status === 'waitlist')
          const isExpanded = expandedEvent === evt.id
          const filtered = filteredForEvent(evt.id)

          return (
            <section key={evt.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-brand-dark">{evt.name}</h2>
                  <p className="text-xs text-brand-muted">
                    {CATEGORY_LABELS[evt.category] ?? evt.category}
                    {evt.skill_level ? ` · ${evt.skill_level}` : ''}
                    {evt.max_teams
                      ? ` · ${registeredRegs.length}/${evt.max_teams}`
                      : ` · ${registeredRegs.length} registered`}
                  </p>
                </div>
              </div>

              {regs.length === 0 ? (
                <p className="text-xs text-brand-muted italic">No registrations yet.</p>
              ) : (
                <div className="space-y-1">
                  {registeredRegs.map((r, i) => {
                    const p = r.profile
                    const key = `${evt.id}-${p.id}`
                    return (
                      <div key={p.id} className="flex items-center gap-3 bg-brand-surface border border-brand-border rounded-xl px-3 py-2">
                        <span className="text-xs text-brand-muted w-5 text-right">{i + 1}</span>
                        <div className="w-7 h-7 rounded-full overflow-hidden bg-brand-soft border border-brand-border flex-shrink-0">
                          {p.profile_photo_url
                            ? <img src={p.profile_photo_url} alt={p.name} className="w-full h-full object-cover" />
                            : <span className="flex items-center justify-center w-full h-full text-brand-muted text-xs">{p.name[0]}</span>
                          }
                        </div>
                        <span className="flex-1 text-sm font-medium text-brand-dark">{p.name}</span>
                        {r.partner_name && (
                          <span className="text-xs text-brand-muted">w/ {r.partner_name}</span>
                        )}
                        <button
                          onClick={() => handleRemove(evt.id, p.id)}
                          disabled={removingKey === key}
                          className="px-2 py-1 rounded text-xs text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40"
                        >
                          {removingKey === key ? '…' : 'Remove'}
                        </button>
                      </div>
                    )
                  })}
                  {waitlistedRegs.map((r, i) => {
                    const p = r.profile
                    const key = `${evt.id}-${p.id}`
                    return (
                      <div key={p.id} className="flex items-center gap-3 bg-brand-surface border border-yellow-200 rounded-xl px-3 py-2">
                        <span className="text-xs text-brand-muted w-5 text-right">{registeredRegs.length + i + 1}</span>
                        <span className="flex-1 text-sm text-brand-dark">{p.name}</span>
                        {r.partner_name && (
                          <span className="text-xs text-brand-muted">w/ {r.partner_name}</span>
                        )}
                        <span className="text-xs text-yellow-700 font-medium">Waitlist</span>
                        <button
                          onClick={() => handleRemove(evt.id, p.id)}
                          disabled={removingKey === key}
                          className="px-2 py-1 rounded text-xs text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40"
                        >
                          {removingKey === key ? '…' : 'Remove'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Add Player for this event */}
              <div className="pt-1">
                <button
                  onClick={() => setExpandedEvent(isExpanded ? null : evt.id)}
                  className="text-xs text-brand-active underline underline-offset-2"
                >
                  {isExpanded ? 'Hide add player' : '+ Add player'}
                </button>
                {isExpanded && (
                  <div className="mt-2 space-y-2">
                    <input
                      type="text"
                      value={getSearch(evt.id)}
                      onChange={(e) => setSearch(evt.id, e.target.value)}
                      placeholder="Search by name…"
                      className="w-full px-3 py-2 text-sm border border-brand-border rounded-lg bg-brand-surface text-brand-dark placeholder:text-brand-muted focus:outline-none focus:ring-1 focus:ring-brand-active"
                    />
                    {filtered.length > 0 && (
                      <div className="border border-brand-border rounded-lg overflow-hidden divide-y divide-brand-border">
                        {filtered.map((player) => {
                          const key = `${evt.id}-${player.id}`
                          return (
                            <button
                              key={player.id}
                              onClick={() => handleAdd(evt.id, player)}
                              disabled={addingKey === key}
                              className="w-full text-left px-3 py-2 text-sm text-brand-dark hover:bg-brand-soft disabled:opacity-40 flex items-center justify-between"
                            >
                              <span>{player.name}</span>
                              {addingKey === key && (
                                <span className="text-xs text-brand-muted">Adding…</span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {getSearch(evt.id).trim() && filtered.length === 0 && (
                      <p className="text-xs text-brand-muted">No matching players found.</p>
                    )}
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </main>
  )
}
