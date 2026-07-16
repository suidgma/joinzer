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

// The requester's substitute status line inside their attendance card. Shows the plain-language state
// (never a raw status label) and, while open, a Cancel action. A filled request has no cancel button
// here — reversing a placed sub is organizer/withdrawal territory (Phase 5).
export default function RequesterSubStatus({ request, onCancelled }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelled, setCancelled] = useState(false)

  async function cancel() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/league-sub-requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(b.error ?? 'Could not cancel the request.')
        return
      }
      setCancelled(true)
      onCancelled?.()
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (cancelled) {
    return <p className="text-xs text-brand-muted">Substitute request cancelled.</p>
  }

  if (request.status === 'open') {
    return (
      <div className="rounded-xl border border-brand-border bg-brand-soft px-3 py-2 space-y-1.5">
        <p className="text-xs font-semibold text-brand-active">🔎 Looking for a substitute…</p>
        <p className="text-[11px] text-brand-muted">Eligible players can pick this up — no approval needed.</p>
        <button
          onClick={cancel}
          disabled={busy}
          className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
        >
          {busy ? 'Cancelling…' : 'Cancel request'}
        </button>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </div>
    )
  }

  if (request.status === 'filled') {
    const byOrganizer = request.fulfillment_mode === 'organizer_assigned'
    return (
      <div className="rounded-xl border border-brand-border bg-brand-soft px-3 py-2">
        <p className="text-xs font-semibold text-brand-active">
          ✓ Substitute {byOrganizer ? 'assigned by organizer' : 'confirmed'}
          {request.subName ? `: ${request.subName}` : ''}
        </p>
        <p className="text-[11px] text-brand-muted">You&apos;re covered. Need to change it? Contact your organizer.</p>
      </div>
    )
  }

  return null
}
