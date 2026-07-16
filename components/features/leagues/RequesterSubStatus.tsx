'use client'

import { useState } from 'react'

export type RequesterRequest = {
  id: string
  status: 'open' | 'filled' | 'cancelled' | 'expired'
  fulfillment_mode: 'open_pool' | 'self_assigned' | 'organizer_assigned'
  subName?: string | null
}

type Props = {
  request: RequesterRequest
  onCancelled?: () => void
}

// The requester's substitute status line. Open → Cancel. Filled → "I can attend after all" (reclaim,
// before start; the RPC rejects after start with a friendly message). No raw status labels.
export default function RequesterSubStatus({ request, onCancelled }: Props) {
  const [busy, setBusy] = useState<null | 'cancel' | 'reclaim'>(null)
  const [error, setError] = useState<string | null>(null)
  const [resolved, setResolved] = useState<null | 'cancelled' | 'reclaimed'>(null)
  const [confirmReclaim, setConfirmReclaim] = useState(false)

  async function cancel() {
    setBusy('cancel'); setError(null)
    try {
      const res = await fetch(`/api/league-sub-requests/${request.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }),
      })
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Could not cancel the request.'); return }
      setResolved('cancelled'); onCancelled?.()
    } catch { setError('Network error. Try again.') } finally { setBusy(null) }
  }

  async function reclaim() {
    setBusy('reclaim'); setError(null)
    try {
      const res = await fetch(`/api/league-sub-requests/${request.id}/reclaim`, { method: 'POST' })
      if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? 'Could not update. Try again.'); return }
      setResolved('reclaimed'); onCancelled?.()
    } catch { setError('Network error. Try again.') } finally { setBusy(null); setConfirmReclaim(false) }
  }

  if (resolved === 'cancelled') return <p className="text-xs text-brand-muted">Substitute request cancelled.</p>
  if (resolved === 'reclaimed') return <p className="text-xs font-semibold text-brand-active">You&apos;re back in the session. 🎾</p>

  if (request.status === 'open') {
    return (
      <div className="rounded-xl border border-brand-border bg-brand-soft px-3 py-2 space-y-1.5">
        <p className="text-xs font-semibold text-brand-active">🔎 Looking for a substitute…</p>
        <p className="text-[11px] text-brand-muted">Eligible players can pick this up — no approval needed.</p>
        <button onClick={cancel} disabled={busy !== null} className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50">
          {busy === 'cancel' ? 'Cancelling…' : 'Cancel request'}
        </button>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </div>
    )
  }

  if (request.status === 'filled') {
    const byOrganizer = request.fulfillment_mode === 'organizer_assigned'
    return (
      <div className="rounded-xl border border-brand-border bg-brand-soft px-3 py-2 space-y-1.5">
        <p className="text-xs font-semibold text-brand-active">
          ✓ Substitute {byOrganizer ? 'assigned by organizer' : 'confirmed'}{request.subName ? `: ${request.subName}` : ''}
        </p>
        {confirmReclaim ? (
          <div className="space-y-1.5">
            <p className="text-[11px] text-brand-body">Your substitute will be removed and notified. You&apos;ll be restored to the session.</p>
            <div className="flex gap-2">
              <button onClick={reclaim} disabled={busy !== null} className="rounded-lg bg-brand-dark px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">
                {busy === 'reclaim' ? 'Updating…' : 'Yes, I can attend'}
              </button>
              <button onClick={() => setConfirmReclaim(false)} disabled={busy !== null} className="text-xs font-medium text-brand-muted">Never mind</button>
            </div>
          </div>
        ) : (
          <button onClick={() => { setError(null); setConfirmReclaim(true) }} className="text-xs font-semibold text-brand-active hover:underline">
            I can attend after all
          </button>
        )}
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </div>
    )
  }

  return null
}
