'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PlayerCombobox, { type PlayerOption } from '@/components/ui/PlayerCombobox'
import { UserPlus, X } from 'lucide-react'

type Surface = 'play' | 'league' | 'tournament'

type Props = {
  surface: Surface
  // Scope identifiers merged into the request body, e.g. { eventId } for play.
  scope: Record<string, string>
  // Existing Joinzer users to pick from, shown in a searchable "Pick your sub"
  // dropdown. When omitted, the list is fetched from profiles on open (self
  // excluded via currentUserId); the server still validates the choice.
  candidates?: PlayerOption[]
  currentUserId?: string
  label?: string
  caption?: string
}

// Shared player-facing "pick my own substitute" control across Play / Leagues /
// Tournaments. The player picks an existing Joinzer user from a dropdown and the
// sub takes effect immediately — no organizer approval required.
export default function AddSubForMe({
  surface,
  scope,
  candidates,
  currentUserId,
  label = 'Add a sub for me',
  caption = 'Your sub takes your spot right away — no approval needed.',
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetched, setFetched] = useState<PlayerOption[] | null>(null)

  const options = candidates ?? fetched ?? []
  const selectedName = options.find((c) => c.id === selectedId)?.name ?? ''

  async function openPicker() {
    setOpen(true)
    if (!candidates && fetched === null) {
      const supabase = createClient()
      const { data } = await supabase.from('profiles').select('id, name').order('name').limit(1000)
      setFetched(((data ?? []) as PlayerOption[]).filter((p) => p.id !== currentUserId))
    }
  }

  async function submit() {
    if (!selectedId) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/sub-nominations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface, nominatedUserId: selectedId, ...scope }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(json.error ?? 'Could not add your sub')
      return
    }
    setOpen(false)
    setSelectedId('')
    router.refresh()
  }

  if (!open) {
    return (
      <button
        onClick={openPicker}
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
            setSelectedId('')
            setError(null)
          }}
          className="text-brand-muted hover:text-brand-dark"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <PlayerCombobox
        options={options}
        value={selectedId}
        onChange={(id) => {
          setSelectedId(id)
          setError(null)
        }}
        placeholder="Pick your sub…"
        emptyText="No players available to sub"
      />

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        onClick={submit}
        disabled={!selectedId || busy}
        className="w-full py-2.5 rounded-lg bg-brand text-brand-dark text-sm font-bold disabled:opacity-40 hover:bg-brand-hover transition-colors"
      >
        {busy ? 'Adding…' : selectedName ? `Sub in ${selectedName}` : 'Sub them in'}
      </button>

      <p className="text-[11px] text-brand-muted">{caption}</p>
    </div>
  )
}
