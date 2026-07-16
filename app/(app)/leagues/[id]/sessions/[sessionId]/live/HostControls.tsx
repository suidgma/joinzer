'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type Player = { id: string; name: string }

// Compact host-controls strip for a player-run league's live session, shown above the
// LiveSessionManager to whoever can operate the session (owner / co-admin / effective host).
//   • the effective host sees "You're hosting" + a hand-off picker + a subtle Release.
//   • an owner/co-admin who isn't the host sees who's hosting + can assign a present player.
// All actions POST the existing host endpoint and router.refresh() on success.
export default function HostControls({
  sessionId,
  effectiveHostId,
  meId,
  isManager,
  hostName,
  presentPlayers,
}: {
  sessionId: string
  leagueId: string
  effectiveHostId: string | null
  meId: string
  isManager: boolean
  hostName: string | null
  presentPlayers: Player[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState('')

  const isHost = !!effectiveHostId && effectiveHostId === meId

  async function setHost(target: string | null) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/league-sessions/${sessionId}/host`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host_user_id: target }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        startTransition(() => router.refresh())
        return
      }
      if (res.status === 409) startTransition(() => router.refresh())
      setError(json?.error ?? 'Could not update host.')
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const noPresent = presentPlayers.length === 0

  return (
    <div className="rounded-xl border border-brand-border bg-brand-surface p-3 text-sm space-y-2">
      {isHost ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-brand-dark">🎾 You&apos;re hosting tonight</span>
          <button
            type="button"
            onClick={() => setHost(null)}
            disabled={busy || pending}
            className="text-xs text-brand-muted underline hover:text-brand-dark disabled:opacity-60"
          >
            Release
          </button>
        </div>
      ) : (
        <p className="text-brand-muted">
          {effectiveHostId ? (
            <>🎾 <span className="font-medium text-brand-dark">{hostName ?? 'A player'}</span> is hosting tonight.</>
          ) : (
            'No host claimed yet.'
          )}
        </p>
      )}

      {(isHost || isManager) && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={busy || pending || noPresent}
            className="rounded-lg border border-brand-border px-2 py-1 text-sm text-brand-dark disabled:opacity-60"
          >
            <option value="">{noPresent ? 'No present players' : 'Select a player…'}</option>
            {presentPlayers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => selectedId && setHost(selectedId)}
            disabled={busy || pending || !selectedId}
            className="rounded-lg bg-brand-active px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
          >
            {isHost ? 'Hand off' : 'Assign host'}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
