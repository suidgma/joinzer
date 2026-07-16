'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

// Roster player claims an empty host seat for a player-run league's session.
// POSTs the (already-built) host endpoint; a 409 means someone else just claimed —
// surface the message AND refresh so the UI catches up.
export default function ClaimHostButton({
  sessionId,
  meId,
  redirectTo,
  label,
}: {
  sessionId: string
  leagueId: string
  meId: string
  // When set, navigate here on a successful claim (e.g. straight into the run screen from the
  // league page). Otherwise just refresh in place (the live-page host gate).
  redirectTo?: string
  label?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function claim() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/league-sessions/${sessionId}/host`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host_user_id: meId }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        startTransition(() => (redirectTo ? router.push(redirectTo) : router.refresh()))
        return
      }
      // 409 = someone else just claimed; refresh so the UI catches up to who's hosting.
      if (res.status === 409) startTransition(() => router.refresh())
      setError(json?.error ?? 'Could not claim hosting.')
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={claim}
        disabled={busy || pending}
        className="bg-brand-active text-white rounded-xl px-4 py-2 font-semibold disabled:opacity-60"
      >
        {busy ? 'Claiming…' : (label ?? "Claim host — run tonight's session")}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
