'use client'

import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import PlayerCombobox from '@/components/ui/PlayerCombobox'

type Player = { id: string; name: string }

// Captain-only: invite players to a play session. They get a notification with a
// link and join themselves. Players are loaded lazily the first time it opens.
export default function InvitePlayers({ eventId, existingUserIds }: { eventId: string; existingUserIds: string[] }) {
  const [open, setOpen] = useState(false)
  const [players, setPlayers] = useState<Player[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Player[]>([])
  const [sending, setSending] = useState(false)
  const [sentCount, setSentCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function openInvite() {
    setOpen(true)
    setSentCount(null)
    setError(null)
    if (players) return
    setLoading(true)
    try {
      const res = await fetch('/api/players')
      const json = await res.json().catch(() => ({}))
      setPlayers(((json.players ?? []) as { id: string; name: string }[]).map((p) => ({ id: p.id, name: p.name })))
    } catch {
      setError('Could not load players')
    } finally {
      setLoading(false)
    }
  }

  const excluded = new Set([...existingUserIds, ...selected.map((s) => s.id)])
  const options = (players ?? []).filter((p) => !excluded.has(p.id))

  function pick(userId: string) {
    const p = (players ?? []).find((x) => x.id === userId)
    if (p) setSelected((prev) => [...prev, p])
  }

  async function send() {
    if (selected.length === 0) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/events/${eventId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: selected.map((s) => s.id) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Failed to send invites')
        return
      }
      setSentCount(json.invited ?? selected.length)
      setSelected([])
      setOpen(false)
    } catch {
      setError('Network error — please retry')
    } finally {
      setSending(false)
    }
  }

  if (!open) {
    return (
      <div>
        <button
          onClick={openInvite}
          className="w-full flex items-center justify-center gap-2 border border-brand-border bg-brand-surface text-brand-dark rounded-xl py-2.5 text-sm font-semibold hover:bg-brand-soft transition-colors"
        >
          <UserPlus className="w-4 h-4" /> Invite players
        </button>
        {sentCount != null && (
          <p className="text-xs text-green-700 mt-1 text-center">
            Invited {sentCount} player{sentCount !== 1 ? 's' : ''} — they&apos;ll get a notification ✓
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-semibold text-brand-dark">Invite players</h2>
        <button onClick={() => setOpen(false)} className="text-xs text-brand-muted px-1" aria-label="Close">✕</button>
      </div>
      <p className="text-xs text-brand-muted">They&apos;ll get a notification with a link to join this session.</p>

      {loading ? (
        <p className="text-sm text-brand-muted">Loading players…</p>
      ) : (
        <PlayerCombobox options={options} value="" onChange={pick} placeholder="Search players by name…" />
      )}

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 bg-brand-soft text-brand-dark text-xs px-2 py-1 rounded-full">
              {p.name}
              <button onClick={() => setSelected((prev) => prev.filter((x) => x.id !== p.id))} className="text-brand-muted hover:text-red-500" aria-label={`Remove ${p.name}`}>✕</button>
            </span>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={send}
        disabled={selected.length === 0 || sending}
        className="w-full bg-brand text-brand-dark rounded-xl py-2 text-sm font-semibold hover:bg-brand-hover disabled:opacity-40 transition-colors"
      >
        {sending ? 'Sending…' : selected.length === 0 ? 'Send invites' : `Send ${selected.length} invite${selected.length !== 1 ? 's' : ''}`}
      </button>
    </div>
  )
}
