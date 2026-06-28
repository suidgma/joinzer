'use client'

import { useState, useRef } from 'react'
import { useDialog } from '@/components/ui/DialogProvider'
import Link from 'next/link'
import { GripVertical, ArrowUp } from 'lucide-react'
import RatingBadge from '@/components/features/RatingBadge'

type PlayerReg = {
  id: string
  status: string
  registered_at: string
  sort_order: number | null
  is_co_admin: boolean
  user_id: string
  partner_user_id: string | null
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

type AvailablePlayer = { id: string; name: string }

type Props = {
  leagueId: string
  leagueName: string
  maxPlayers: number | null
  partnerMode: string | null
  registered: PlayerReg[]
  waitlisted: PlayerReg[]
  subInterest: SubEntry[]
  availablePlayers: AvailablePlayer[]
  isPrimaryOrganizer: boolean
}

export default function LeagueRosterManager({
  leagueId,
  leagueName,
  maxPlayers,
  partnerMode,
  registered: initialRegistered,
  waitlisted,
  subInterest,
  availablePlayers: initialAvailable,
  isPrimaryOrganizer,
}: Props) {
  const [registered, setRegistered] = useState<PlayerReg[]>(initialRegistered)
  const { alert } = useDialog()
  const [availablePlayers, setAvailablePlayers] = useState<AvailablePlayer[]>(initialAvailable)
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [togglingAdminId, setTogglingAdminId] = useState<string | null>(null)
  const [fullError, setFullError] = useState(false)
  const [assigningPartnerId, setAssigningPartnerId] = useState<string | null>(null)
  const [partnerSelections, setPartnerSelections] = useState<Record<string, string>>({})
  const [savingPartnerId, setSavingPartnerId] = useState<string | null>(null)

  // Drag-to-reorder the roster (organizer-only). Order is display-only — it
  // doesn't seed anything — so we persist best-effort on drop.
  const dragIndex = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  function handleDragStart(i: number) { dragIndex.current = i }
  function handleDragOver(e: React.DragEvent, i: number) { e.preventDefault(); setDragOver(i) }
  function handleDrop(i: number) {
    const from = dragIndex.current
    if (from === null || from === i) { setDragOver(null); return }
    const next = [...registered]
    const [moved] = next.splice(from, 1)
    next.splice(i, 0, moved)
    setRegistered(next)
    setDragOver(null)
    saveOrder(next)
  }
  function handleDragEnd() { dragIndex.current = null; setDragOver(null) }

  async function saveOrder(list: PlayerReg[]) {
    try {
      await fetch(`/api/leagues/${leagueId}/roster-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: list.map(r => r.id) }),
      })
    } catch { /* cosmetic order — ignore failures */ }
  }

  const isFixedPartner = partnerMode === 'fixed'
  const isFull = maxPlayers != null && registered.length >= maxPlayers

  // Build userId → name map for partner display
  const nameById = Object.fromEntries(registered.map(r => [r.user_id, r.profile.name]))

  // Compute unique teams (deduplicated pairs) sorted alphabetically
  const teams = (() => {
    const seen = new Set<string>()
    const result: Array<{ key: string; p1: PlayerReg; p2: PlayerReg; label: string }> = []
    for (const r of registered) {
      if (!r.partner_user_id) continue
      const partner = registered.find(p => p.user_id === r.partner_user_id)
      if (!partner) continue
      const canonical = r.user_id < r.partner_user_id
        ? `${r.user_id}|${r.partner_user_id}`
        : `${r.partner_user_id}|${r.user_id}`
      if (seen.has(canonical)) continue
      seen.add(canonical)
      const n1 = r.profile.name.split(' ')[0]
      const n2 = partner.profile.name.split(' ')[0]
      const [first, second] = n1.localeCompare(n2) <= 0 ? [n1, n2] : [n2, n1]
      result.push({ key: canonical, p1: r, p2: partner, label: `Team ${first}/${second}` })
    }
    return result.sort((a, b) => a.label.localeCompare(b.label))
  })()

  const unassigned = registered.filter(r => !r.partner_user_id)

  async function handleRemove(userId: string) {
    setRemovingId(userId)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/members/${userId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json()
        await alert({ body: err.error ?? 'Failed to remove player' })
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

  async function handleToggleAdmin(userId: string, current: boolean) {
    setTogglingAdminId(userId)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/members/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_co_admin: !current }),
      })
      if (!res.ok) {
        const err = await res.json()
        await alert({ body: err.error ?? 'Failed to update admin status' })
        return
      }
      setRegistered((prev) =>
        prev.map((r) => r.user_id === userId ? { ...r, is_co_admin: !current } : r)
      )
    } finally {
      setTogglingAdminId(null)
    }
  }

  async function handleAdd() {
    const player = availablePlayers.find((p) => p.id === selectedPlayerId)
    if (!player) return
    if (isFull) { setFullError(true); return }
    setFullError(false)
    setAddingId(player.id)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: player.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        await alert({ body: json.error ?? 'Failed to add player' })
        return
      }
      const newReg: PlayerReg = {
        id: json.registration_id ?? `pending-${player.id}`,
        status: 'registered',
        registered_at: new Date().toISOString(),
        sort_order: null,
        is_co_admin: false,
        user_id: player.id,
        partner_user_id: null,
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

  async function handleAssignPartner(userId: string) {
    const partnerId = partnerSelections[userId] || null
    setSavingPartnerId(userId)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/assign-partner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId1: userId, userId2: partnerId }),
      })
      if (!res.ok) {
        const err = await res.json()
        await alert({ body: err.error ?? 'Failed to assign partner' })
        return
      }
      // Update local state to reflect the new partner links
      setRegistered((prev) => prev.map(r => {
        if (r.user_id === userId) return { ...r, partner_user_id: partnerId }
        if (partnerId && r.user_id === partnerId) return { ...r, partner_user_id: userId }
        // Clear old back-links
        if (r.partner_user_id === userId) return { ...r, partner_user_id: null }
        if (partnerId && r.partner_user_id === partnerId) return { ...r, partner_user_id: null }
        return r
      }))
      setAssigningPartnerId(null)
      setPartnerSelections(prev => { const n = { ...prev }; delete n[userId]; return n })
    } finally {
      setSavingPartnerId(null)
    }
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-6">
      <div className="flex items-center gap-2">
        <Link href={`/leagues/${leagueId}`} className="text-brand-muted text-sm">
          ← Back
        </Link>
      </div>

      <h1 className="font-heading text-xl font-bold text-brand-dark">Roster & Subs</h1>

      {/* Fixed partner assignment section */}
      {isFixedPartner && isPrimaryOrganizer && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">Fixed Partners</h2>
            <span className="text-xs text-brand-muted">Required for schedule generation</span>
          </div>
          <div className="bg-brand-soft border border-brand-border rounded-xl p-3 space-y-2">

            {/* Paired teams — sorted alphabetically, deduplicated */}
            {teams.map(({ key, p1, p2, label }) => (
              <div key={key} className="border-b border-brand-border last:border-0 pb-2 last:pb-0 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-brand-dark">{label}</span>
                </div>
                {/* Per-player change rows — only shown when that player is in edit mode */}
                {[p1, p2].map(r => {
                  const isAssigning = assigningPartnerId === r.user_id
                  const eligible = registered.filter(other =>
                    other.user_id !== r.user_id &&
                    (other.partner_user_id === null || other.partner_user_id === r.user_id)
                  )
                  return (
                    <div key={r.user_id} className="flex items-center gap-2 pl-2">
                      <span className="text-xs text-brand-muted flex-1 truncate">{r.profile.name}</span>
                      {isAssigning ? (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <select
                            value={partnerSelections[r.user_id] ?? r.partner_user_id ?? ''}
                            onChange={e => setPartnerSelections(prev => ({ ...prev, [r.user_id]: e.target.value }))}
                            className="input text-xs py-0.5"
                          >
                            <option value="">— No partner —</option>
                            {eligible.map(o => (
                              <option key={o.user_id} value={o.user_id}>{o.profile.name}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleAssignPartner(r.user_id)}
                            disabled={savingPartnerId === r.user_id}
                            className="text-xs px-2 py-0.5 rounded bg-brand text-brand-dark font-semibold disabled:opacity-40"
                          >
                            {savingPartnerId === r.user_id ? '…' : 'Save'}
                          </button>
                          <button onClick={() => setAssigningPartnerId(null)} className="text-xs text-brand-muted">✕</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setAssigningPartnerId(r.user_id)
                            setPartnerSelections(prev => ({ ...prev, [r.user_id]: r.partner_user_id ?? '' }))
                          }}
                          className="text-xs text-brand-active underline underline-offset-2 flex-shrink-0"
                        >
                          Change
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}

            {/* Unassigned players */}
            {unassigned.length > 0 && (
              <>
                {teams.length > 0 && <p className="text-[10px] font-semibold text-brand-muted uppercase tracking-wide pt-1">Unassigned</p>}
                {unassigned.map(r => {
                  const isAssigning = assigningPartnerId === r.user_id
                  const eligible = registered.filter(other =>
                    other.user_id !== r.user_id &&
                    (other.partner_user_id === null || other.partner_user_id === r.user_id)
                  )
                  return (
                    <div key={r.user_id} className="flex items-center gap-2 py-1 border-b border-brand-border last:border-0">
                      <span className="text-sm font-medium text-brand-dark flex-1 min-w-0 truncate">{r.profile.name}</span>
                      <span className="text-xs text-red-500 font-medium flex-shrink-0">No partner</span>
                      {isAssigning ? (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <select
                            value={partnerSelections[r.user_id] ?? ''}
                            onChange={e => setPartnerSelections(prev => ({ ...prev, [r.user_id]: e.target.value }))}
                            className="input text-xs py-0.5"
                          >
                            <option value="">— Select partner —</option>
                            {eligible.map(o => (
                              <option key={o.user_id} value={o.user_id}>{o.profile.name}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleAssignPartner(r.user_id)}
                            disabled={savingPartnerId === r.user_id}
                            className="text-xs px-2 py-0.5 rounded bg-brand text-brand-dark font-semibold disabled:opacity-40"
                          >
                            {savingPartnerId === r.user_id ? '…' : 'Save'}
                          </button>
                          <button onClick={() => setAssigningPartnerId(null)} className="text-xs text-brand-muted">✕</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setAssigningPartnerId(r.user_id)
                            setPartnerSelections(prev => ({ ...prev, [r.user_id]: '' }))
                          }}
                          className="text-xs text-brand-active underline underline-offset-2 flex-shrink-0"
                        >
                          Assign
                        </button>
                      )}
                    </div>
                  )
                })}
              </>
            )}

            {teams.length === 0 && unassigned.length === 0 && (
              <p className="text-xs text-brand-muted">No registered players yet.</p>
            )}
          </div>
        </section>
      )}

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
                <div
                  key={r.id}
                  draggable={isPrimaryOrganizer}
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={e => handleDragOver(e, i)}
                  onDrop={() => handleDrop(i)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-center gap-3 bg-brand-surface border rounded-xl px-3 py-2 transition-colors ${
                    dragOver === i ? 'border-brand bg-brand-soft' : 'border-brand-border'
                  }`}
                >
                  {isPrimaryOrganizer && (
                    <GripVertical className="w-3.5 h-3.5 shrink-0 text-brand-muted cursor-grab active:cursor-grabbing" />
                  )}
                  <span className="text-xs text-brand-muted w-5 text-right">{i + 1}</span>
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-brand-soft border border-brand-border flex-shrink-0">
                    {p.profile_photo_url
                      ? <img src={p.profile_photo_url} alt={p.name} className="w-full h-full object-cover" />
                      : <span className="flex items-center justify-center w-full h-full text-brand-muted text-xs">{p.name[0]}</span>
                    }
                  </div>
                  <span className="flex-1 text-sm font-medium text-brand-dark">{p.name}</span>
                  <RatingBadge
                    ratingSource={p.rating_source}
                    duprRating={p.dupr_rating}
                    estimatedRating={p.estimated_rating}
                  />
                  {r.is_co_admin && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-brand/20 text-brand-dark leading-none">
                      Co-admin
                    </span>
                  )}
                  {isPrimaryOrganizer && (
                    <button
                      onClick={() => handleToggleAdmin(r.user_id, r.is_co_admin)}
                      disabled={togglingAdminId === r.user_id}
                      className={`px-2 py-1 rounded text-xs border disabled:opacity-40 transition-colors ${
                        r.is_co_admin
                          ? 'text-brand-muted border-brand-border hover:bg-brand-soft'
                          : 'text-brand-active border-brand-active hover:bg-brand/10'
                      }`}
                    >
                      {togglingAdminId === r.user_id ? '…' : r.is_co_admin ? 'Revoke' : 'Co-admin'}
                    </button>
                  )}
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

        {/* Drag-to-reorder affordance hint — organizer only, when reordering is possible */}
        {isPrimaryOrganizer && registered.length > 1 && (
          <div className="flex items-center gap-1.5 px-1 text-[10px] font-medium text-brand-muted">
            <ArrowUp className="w-3 h-3 shrink-0" />
            <span>Drag to re-order</span>
          </div>
        )}

        {/* Add Player */}
        {availablePlayers.length > 0 && (
          <div className="pt-2 space-y-2">
            <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Add Player</p>
            <div className="flex gap-2">
              <select
                value={selectedPlayerId}
                onChange={(e) => { setSelectedPlayerId(e.target.value); setFullError(false) }}
                className="flex-1 input text-sm"
                disabled={isFull}
              >
                <option value="">— Select a player —</option>
                {availablePlayers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                onClick={handleAdd}
                disabled={!selectedPlayerId || !!addingId || isFull}
                className="px-4 py-2 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-40 transition-colors"
              >
                {addingId ? '…' : 'Add'}
              </button>
            </div>
            {isFull && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">
                This league is at its maximum capacity of {maxPlayers} players. Remove a player to add another.
              </div>
            )}
            {fullError && !isFull && (
              <p className="text-sm text-red-600">League is full — cannot add more players.</p>
            )}
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

    </main>
  )
}
