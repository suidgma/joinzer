'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import PlayerCombobox from '@/components/ui/PlayerCombobox'
import { X } from 'lucide-react'

type Member = { id: string; registrationId: string; name: string; isCaptain: boolean }
type Available = { registrationId: string; name: string }

// Captain-run roster self-management: a team captain adds/removes their own team's
// players (from the league's un-rostered registrants). Organizer can do this too.
export default function CaptainRoster({
  leagueId,
  teamId,
  teamName,
  members,
  available,
}: {
  leagueId: string
  teamId: string
  teamName: string
  members: Member[]
  available: Available[]
}) {
  const router = useRouter()
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    if (!pick) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/leagues/${leagueId}/teams/${teamId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registration_id: pick }),
    })
    setBusy(false)
    if (res.ok) {
      setPick('')
      router.refresh()
    } else {
      const j = await res.json().catch(() => ({}))
      setError(j.error ?? 'Could not add player')
    }
  }

  async function remove(memberId: string) {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/leagues/${leagueId}/teams/${teamId}/members/${memberId}`, { method: 'DELETE' })
    setBusy(false)
    if (res.ok) router.refresh()
    else {
      const j = await res.json().catch(() => ({}))
      setError(j.error ?? 'Could not remove player')
    }
  }

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
      <div>
        <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Your team — roster</p>
        <p className="text-xs text-brand-muted">{teamName} · manage who&apos;s on your team.</p>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <ul className="divide-y divide-brand-border">
        {members.length === 0 && <li className="py-2 text-xs text-brand-muted">No players yet.</li>}
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="text-brand-dark truncate">
              {m.name}
              {m.isCaptain && <span className="ml-1 text-[10px] font-bold text-brand-active uppercase">Captain</span>}
            </span>
            {!m.isCaptain && (
              <button
                onClick={() => remove(m.id)}
                disabled={busy}
                className="text-brand-muted hover:text-red-600 shrink-0 disabled:opacity-50"
                aria-label={`Remove ${m.name}`}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {available.length > 0 && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <PlayerCombobox
              options={available.map((a) => ({ id: a.registrationId, name: a.name }))}
              value={pick}
              onChange={setPick}
              placeholder="Add a player…"
            />
          </div>
          <button
            onClick={add}
            disabled={busy || !pick}
            className="bg-brand text-brand-dark rounded-lg text-sm font-semibold px-4 py-2 hover:bg-brand-hover disabled:opacity-50 shrink-0"
          >
            Add
          </button>
        </div>
      )}
    </div>
  )
}
