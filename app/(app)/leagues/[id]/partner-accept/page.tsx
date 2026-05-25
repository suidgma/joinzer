'use client'

import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, XCircle, Clock } from 'lucide-react'

type InvitationData = {
  league_name: string | null
  league_id: string
  captain_name: string | null
  invitee_email: string
  expires_at: string
  status: string
}

export default function PartnerAcceptPage() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [invitation, setInvitation] = useState<InvitationData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<'accepted' | 'declined' | null>(null)

  useEffect(() => {
    if (!token) { setLoadError('Missing invitation token'); return }

    fetch(`/api/leagues/invitations/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setLoadError(data.error); return }
        setInvitation(data)
      })
      .catch(() => setLoadError('Could not load invitation'))
  }, [token])

  async function handleAccept() {
    if (!token) return
    setActionLoading(true)
    setActionError(null)
    const res = await fetch(`/api/leagues/invitations/${token}/accept`, { method: 'POST' })
    const data = await res.json()
    setActionLoading(false)
    if (!res.ok) { setActionError(data.error ?? 'Could not accept invitation'); return }
    if (data.url) { window.location.href = data.url; return }
    setOutcome('accepted')
  }

  async function handleDecline() {
    if (!token) return
    setActionLoading(true)
    setActionError(null)
    const res = await fetch(`/api/leagues/invitations/${token}/decline`, { method: 'POST' })
    const data = await res.json()
    setActionLoading(false)
    if (!res.ok) { setActionError(data.error ?? 'Could not decline invitation'); return }
    setOutcome('declined')
  }

  if (!token || loadError) {
    return (
      <main className="max-w-sm mx-auto px-4 py-12 text-center space-y-3">
        <XCircle size={40} className="mx-auto text-red-400" />
        <h1 className="font-heading text-lg font-bold text-brand-dark">Invitation not found</h1>
        <p className="text-sm text-brand-muted">{loadError ?? 'This invitation link is invalid.'}</p>
        <Link href="/leagues" className="text-sm text-brand-active underline">Browse leagues</Link>
      </main>
    )
  }

  if (!invitation) {
    return (
      <main className="max-w-sm mx-auto px-4 py-12 text-center">
        <p className="text-sm text-brand-muted">Loading invitation…</p>
      </main>
    )
  }

  const isExpired = invitation.status === 'expired' || new Date() > new Date(invitation.expires_at)
  const isResolved = invitation.status !== 'pending' || isExpired

  const expiresLabel = new Date(invitation.expires_at).toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })

  if (outcome === 'accepted') {
    return (
      <main className="max-w-sm mx-auto px-4 py-12 text-center space-y-3">
        <CheckCircle size={40} className="mx-auto text-green-500" />
        <h1 className="font-heading text-lg font-bold text-brand-dark">You&apos;re in!</h1>
        <p className="text-sm text-brand-muted">
          You and {invitation.captain_name ?? 'your partner'} are now registered for {invitation.league_name ?? 'the league'}.
        </p>
        <Link href={`/leagues/${invitation.league_id}`} className="text-sm text-brand-active underline">
          View league →
        </Link>
      </main>
    )
  }

  if (outcome === 'declined') {
    return (
      <main className="max-w-sm mx-auto px-4 py-12 text-center space-y-3">
        <XCircle size={40} className="mx-auto text-brand-muted" />
        <h1 className="font-heading text-lg font-bold text-brand-dark">Invitation declined</h1>
        <p className="text-sm text-brand-muted">
          {invitation.captain_name ?? 'Your partner'} will be notified. Their registration has been cancelled.
        </p>
        <Link href="/leagues" className="text-sm text-brand-active underline">Browse leagues</Link>
      </main>
    )
  }

  if (isResolved) {
    const label = invitation.status === 'accepted'
      ? 'This invitation has already been accepted.'
      : invitation.status === 'declined'
        ? 'This invitation was declined.'
        : 'This invitation has expired.'
    return (
      <main className="max-w-sm mx-auto px-4 py-12 text-center space-y-3">
        <Clock size={40} className="mx-auto text-brand-muted" />
        <h1 className="font-heading text-lg font-bold text-brand-dark">Invitation {invitation.status}</h1>
        <p className="text-sm text-brand-muted">{label}</p>
        <Link href="/leagues" className="text-sm text-brand-active underline">Browse leagues</Link>
      </main>
    )
  }

  return (
    <main className="max-w-sm mx-auto px-4 py-10 space-y-5">
      <div className="text-center space-y-1">
        <h1 className="font-heading text-xl font-bold text-brand-dark">Partner invitation</h1>
        <p className="text-sm text-brand-muted">
          {invitation.captain_name ?? 'Someone'} invited you as their doubles partner
        </p>
      </div>

      <div className="bg-white border border-brand-border rounded-2xl p-5 space-y-3">
        <div className="space-y-2">
          {invitation.league_name && (
            <div className="flex gap-2">
              <span className="text-xs text-brand-muted w-24 flex-shrink-0 pt-0.5">League</span>
              <span className="text-sm text-brand-dark font-medium">{invitation.league_name}</span>
            </div>
          )}
          {invitation.captain_name && (
            <div className="flex gap-2">
              <span className="text-xs text-brand-muted w-24 flex-shrink-0 pt-0.5">Invited by</span>
              <span className="text-sm text-brand-dark">{invitation.captain_name}</span>
            </div>
          )}
          <div className="flex gap-2">
            <span className="text-xs text-brand-muted w-24 flex-shrink-0 pt-0.5">Expires</span>
            <span className="text-sm text-brand-dark">{expiresLabel} PT</span>
          </div>
        </div>

        {actionError && <p className="text-xs text-red-600">{actionError}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={handleDecline}
            disabled={actionLoading}
            className="flex-1 py-2.5 rounded-xl border border-brand-border text-sm text-brand-muted hover:text-brand-dark disabled:opacity-50 transition-colors"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={actionLoading}
            className="flex-1 py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
          >
            {actionLoading ? 'Processing…' : 'Accept'}
          </button>
        </div>
      </div>

      <p className="text-[11px] text-center text-brand-muted">
        Invitations expire 72 hours after being sent.
      </p>
    </main>
  )
}
