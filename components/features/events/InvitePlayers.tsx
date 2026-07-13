'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import PlayerCombobox from '@/components/ui/PlayerCombobox'

type Player = { id: string; name: string }
type Busy = 'add' | 'invite' | 'email' | null

// Captain-only: add players straight into the session, invite existing players
// (notify-to-join), or invite someone by email who isn't on Joinzer yet.
export default function InvitePlayers({ eventId, existingUserIds }: { eventId: string; existingUserIds: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [players, setPlayers] = useState<Player[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Player[]>([])
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function openPanel() {
    setOpen(true)
    setMsg(null)
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

  async function act(mode: 'add' | 'invite') {
    if (selected.length === 0) return
    setBusy(mode)
    setError(null)
    setMsg(null)
    const path = mode === 'add' ? `/api/events/${eventId}/participants` : `/api/events/${eventId}/invite`
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: selected.map((s) => s.id) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Something went wrong')
        return
      }
      const n = selected.length
      setSelected([])
      if (mode === 'add') {
        const added = json.added ?? n
        const wl = json.waitlisted ?? 0
        setMsg(`Added ${added} player${added !== 1 ? 's' : ''}${wl ? ` (${wl} waitlisted)` : ''}`)
        router.refresh()
      } else {
        const inv = json.invited ?? n
        setMsg(`Invited ${inv} player${inv !== 1 ? 's' : ''}`)
      }
    } catch {
      setError('Network error — please retry')
    } finally {
      setBusy(null)
    }
  }

  async function emailInvite() {
    const e = email.trim()
    if (!e) return
    setBusy('email')
    setError(null)
    setMsg(null)
    try {
      const res = await fetch(`/api/events/${eventId}/invite-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Failed to send')
        return
      }
      setMsg(`Emailed an invite to ${e}`)
      setEmail('')
    } catch {
      setError('Network error — please retry')
    } finally {
      setBusy(null)
    }
  }

  if (!open) {
    return (
      <div>
        <button
          onClick={openPanel}
          className="w-full flex items-center justify-center gap-2 border border-brand-border bg-brand-surface text-brand-dark rounded-xl py-2.5 text-sm font-semibold hover:bg-brand-soft transition-colors"
        >
          <UserPlus className="w-4 h-4" /> Invite / add players
        </button>
        {msg && <p className="text-xs text-green-700 mt-1 text-center">{msg} ✓</p>}
      </div>
    )
  }

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-semibold text-brand-dark">Invite / add players</h2>
        <button onClick={() => setOpen(false)} className="text-xs text-brand-muted px-1" aria-label="Close">✕</button>
      </div>

      {loading ? (
        <p className="text-sm text-brand-muted">Loading players…</p>
      ) : (
        <PlayerCombobox options={options} value="" onChange={pick} placeholder="Search players by name…" />
      )}

      {selected.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {selected.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 bg-brand-soft text-brand-dark text-xs px-2 py-1 rounded-full">
                {p.name}
                <button onClick={() => setSelected((prev) => prev.filter((x) => x.id !== p.id))} className="text-brand-muted hover:text-red-500" aria-label={`Remove ${p.name}`}>✕</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => act('add')} disabled={busy != null} className="flex-1 bg-brand text-brand-dark rounded-xl py-2 text-sm font-semibold hover:bg-brand-hover disabled:opacity-40 transition-colors">
              {busy === 'add' ? 'Adding…' : 'Add to session'}
            </button>
            <button onClick={() => act('invite')} disabled={busy != null} className="flex-1 border border-brand-border text-brand-dark rounded-xl py-2 text-sm font-semibold hover:bg-brand-soft disabled:opacity-40 transition-colors">
              {busy === 'invite' ? 'Inviting…' : 'Just invite'}
            </button>
          </div>
          <p className="text-[11px] text-brand-muted"><strong>Add</strong> = they join now. <strong>Invite</strong> = they get a notification to join.</p>
        </>
      )}

      <div className="pt-2 border-t border-brand-border space-y-1.5">
        <p className="text-xs font-medium text-brand-dark">Not on Joinzer? Invite by email</p>
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@email.com"
            className="flex-1 input text-sm"
          />
          <button onClick={emailInvite} disabled={busy != null || !email.trim()} className="px-4 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-40 transition-colors">
            {busy === 'email' ? '…' : 'Send'}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {msg && <p className="text-sm text-green-700">{msg} ✓</p>}
    </div>
  )
}
