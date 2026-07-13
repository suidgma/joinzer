'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { UserPlus, X } from 'lucide-react'

type Surface = 'play' | 'league' | 'tournament'

type Props = {
  surface: Surface
  // Scope identifiers merged into the create-nomination request body, e.g.
  // { eventId } for play, { tournamentId, registrationId } for tournaments.
  scope: Record<string, string>
  // A pending nomination by the current player, if one already exists.
  pending?: { id: string; nomineeName: string } | null
  label?: string
  caption?: string
}

// Shared player-facing "nominate my own substitute" control across Play / Leagues /
// Tournaments. Searches Joinzer players by name and posts a pending nomination the
// organizer must approve. When a pending nomination exists, shows its status + cancel.
export default function AddSubForMe({
  surface,
  scope,
  pending = null,
  label = 'Add a sub for me',
  caption = 'Your sub takes your spot once the organizer approves.',
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; name: string }[]>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function search(q: string) {
    setQuery(q)
    setError(null)
    if (!q.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('profiles')
      .select('id, name')
      .ilike('name', `%${q.trim()}%`)
      .order('name')
      .limit(15)
    setResults((data ?? []) as { id: string; name: string }[])
    setSearching(false)
  }

  async function nominate(userId: string) {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/sub-nominations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface, nominatedUserId: userId, ...scope }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(json.error ?? 'Could not send the request')
      return
    }
    setOpen(false)
    setQuery('')
    setResults([])
    router.refresh()
  }

  async function cancel() {
    if (!pending) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/sub-nominations/${pending.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    })
    setBusy(false)
    if (res.ok) router.refresh()
    else setError('Could not cancel')
  }

  if (pending) {
    return (
      <div className="bg-brand-surface border border-brand-border rounded-2xl p-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-brand-dark">
            Sub requested: <span className="font-semibold">{pending.nomineeName}</span>
          </p>
          <p className="text-xs text-brand-muted">Waiting for the organizer to approve.</p>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <button
          onClick={cancel}
          disabled={busy}
          className="text-xs font-medium text-brand-muted hover:text-red-600 shrink-0 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full inline-flex items-center justify-center gap-2 bg-brand-surface border border-brand-border rounded-2xl px-4 py-3 text-sm font-semibold text-brand-dark hover:bg-brand-soft transition-colors"
      >
        <UserPlus className="w-4 h-4" /> {label}
      </button>
    )
  }

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-brand-dark">Pick your sub</p>
        <button
          onClick={() => {
            setOpen(false)
            setQuery('')
            setResults([])
            setError(null)
          }}
          className="text-brand-muted hover:text-brand-dark"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => search(e.target.value)}
        placeholder="Search players by name…"
        className="w-full text-sm px-3 py-2 border border-brand-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand bg-white"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="max-h-56 overflow-y-auto divide-y divide-brand-border">
        {searching ? (
          <p className="text-xs text-brand-muted py-2">Searching…</p>
        ) : results.length === 0 ? (
          <p className="text-xs text-brand-muted py-2">
            {query ? 'No players found' : 'Type a name to search Joinzer players.'}
          </p>
        ) : (
          results.map((r) => (
            <button
              key={r.id}
              disabled={busy}
              onClick={() => nominate(r.id)}
              className="w-full text-left px-1 py-2 text-sm text-brand-dark hover:bg-brand-soft disabled:opacity-50 flex items-center justify-between"
            >
              <span>{r.name}</span>
              <span className="text-xs text-brand-active font-medium">Choose →</span>
            </button>
          ))
        )}
      </div>
      <p className="text-[11px] text-brand-muted">{caption}</p>
    </div>
  )
}
