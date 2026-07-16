'use client'

import { useState } from 'react'
import Link from 'next/link'
import CopyLinkButton from '@/components/features/subs/CopyLinkButton'
import OrganizerSubControls from '@/components/features/subs/OrganizerSubControls'
import type { SubRequestDetail } from '@/lib/subs/loadOpportunities'

function whenLabel(d: SubRequestDetail): string {
  if (!d.date) return 'This session'
  const day = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const t = d.startTime ? ` · ${new Date('1970-01-01T' + d.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''
  return `${day}${t}`
}
function fmt(f: string | null): string {
  return f ? f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'League'
}

// Shared-opportunity detail. Accept goes through the Phase-2 atomic route; the server already
// re-derived eligibility, and the route revalidates again on accept.
export default function SubDetailView({ detail }: { detail: SubRequestDetail }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function accept() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/league-sub-requests/${detail.requestId}/accept`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (res.ok) { setDone(true); return }
      setError(body.error ?? 'Could not confirm. Try again.')
    } catch { setError('Network error. Try again.') } finally { setBusy(false) }
  }

  const closedMessage =
    detail.status === 'filled' ? 'This opportunity has already been filled.' :
    detail.status === 'expired' ? 'No substitute was found — this request has closed.' :
    detail.status === 'cancelled' ? 'This request is no longer active.' : null

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-brand-border bg-brand-surface p-5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-lg font-bold text-brand-dark">Substitute needed</p>
            <p className="text-sm font-semibold text-brand-dark">{detail.leagueName}</p>
          </div>
          <CopyLinkButton path={`/subs/${detail.requestId}`} />
        </div>
        <dl className="text-sm space-y-1.5">
          <div className="flex justify-between gap-3"><dt className="text-brand-muted">When</dt><dd className="text-brand-dark text-right">{whenLabel(detail)}</dd></div>
          {detail.venueName && <div className="flex justify-between gap-3"><dt className="text-brand-muted">Where</dt><dd className="text-brand-dark text-right">{detail.venueName}</dd></div>}
          <div className="flex justify-between gap-3"><dt className="text-brand-muted">Format</dt><dd className="text-brand-dark text-right">{fmt(detail.leagueFormat)}</dd></div>
          {detail.recommended && <div className="flex justify-between gap-3"><dt className="text-brand-muted">Level</dt><dd className="text-brand-dark text-right">{detail.recommended.replace('Recommended rating: ', '')}{detail.userRating != null ? ` · you: ${detail.userRating}` : ''}</dd></div>}
        </dl>

        {detail.ratingWarning && detail.status === 'open' && (
          <p className="text-xs font-medium text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-lg px-2 py-1">{detail.ratingWarning}</p>
        )}

        {done ? (
          <div role="status" className="rounded-xl bg-brand-soft border border-brand-border px-3 py-2 text-sm font-semibold text-brand-active">You&apos;re in! You&apos;re subbing for {detail.leagueName}. 🎾</div>
        ) : closedMessage ? (
          <p className="rounded-xl bg-brand-soft border border-brand-border px-3 py-2 text-sm font-medium text-brand-body">{closedMessage}</p>
        ) : detail.isRequester ? (
          <p className="rounded-xl bg-brand-soft border border-brand-border px-3 py-2 text-sm text-brand-body">This is your own request. <Link href={`/leagues/${detail.leagueId}`} className="font-semibold text-brand-active">Manage it →</Link></p>
        ) : detail.eligible ? (
          <>
            <p className="text-[11px] text-brand-muted">You&apos;ll be added as the substitute for this session. Your results count according to the league&apos;s substitute rules.</p>
            <button onClick={accept} disabled={busy} aria-busy={busy} className="w-full rounded-2xl bg-brand-dark px-4 py-3 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60">
              {busy ? 'Confirming…' : 'I can sub'}
            </button>
          </>
        ) : (
          <p className="rounded-xl bg-brand-soft border border-brand-border px-3 py-2 text-sm text-brand-body">You&apos;re not eligible to sub for this session right now.</p>
        )}
        {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}

        {detail.canManage && detail.status === 'filled' && (
          <OrganizerSubControls requestId={detail.requestId} subName={detail.subName} />
        )}
      </div>

      <Link href="/subs" className="block text-center text-sm font-semibold text-brand-active hover:underline">← All substitute openings</Link>
    </div>
  )
}
