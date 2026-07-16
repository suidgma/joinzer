'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import CopyLinkButton from '@/components/features/subs/CopyLinkButton'
import type { MatchedSubOpportunity } from '@/lib/subs/matching'

function dateLabel(o: MatchedSubOpportunity): string {
  if (!o.date) return o.urgency || 'This session'
  const d = new Date(o.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const t = o.startTime ? ` · ${new Date('1970-01-01T' + o.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''
  return `${d}${t}`
}

function formatLabel(f: string | null): string {
  if (!f) return 'League'
  return f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

type Props = {
  opp: MatchedSubOpportunity
  // Called after a successful accept so the parent can remove the card / refresh.
  onAccepted?: (requestId: string) => void
  compact?: boolean
}

// A matched substitute-opportunity card + an inline accept-confirmation sheet. "I can sub" calls the
// Phase-2 atomic accept route; no organizer-approval language. Reused on Home and /subs.
export default function SubOpportunityCard({ opp, onAccepted, compact }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const firstRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    firstRef.current?.focus()
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  async function accept() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/league-sub-requests/${opp.requestId}/accept`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        setDone(true)
        setOpen(false)
        onAccepted?.(opp.requestId)
        return
      }
      // 409 lost race / conflict, 403/410/422 stale eligibility — the server message is player-friendly.
      setError(body.error ?? 'Could not confirm. Try again.')
    } catch {
      setError('Network error. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div role="status" className="rounded-2xl border border-brand-border bg-brand-soft p-3 text-sm font-semibold text-brand-active">
        You&apos;re in! You&apos;re subbing for {opp.leagueName}. 🎾
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-brand-dark truncate">Substitute needed — {opp.leagueName}</p>
          <p className="text-xs text-brand-muted">
            {dateLabel(opp)}{opp.venueName ? ` · ${opp.venueName}` : ''} · {formatLabel(opp.leagueFormat)}
          </p>
          {opp.recommended && <p className="text-[11px] text-brand-muted mt-0.5">{opp.recommended}</p>}
        </div>
        {opp.urgency && (
          <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase bg-brand-soft text-brand-active">{opp.urgency}</span>
        )}
      </div>

      {opp.ratingWarning && !compact && (
        <p className="text-[11px] font-medium text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-lg px-2 py-1">{opp.ratingWarning}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => { setError(null); setOpen(true) }}
          className="flex-1 rounded-xl bg-brand-dark px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover"
        >
          I can sub
        </button>
        <CopyLinkButton path={`/subs/${opp.requestId}`} label="" className="shrink-0 inline-flex items-center gap-1 text-brand-muted hover:text-brand-dark p-2" />
      </div>
      {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="Confirm substitution" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-sm bg-brand-page rounded-t-3xl sm:rounded-3xl p-5 space-y-3 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-lg font-bold text-brand-dark">Sub for this session?</h2>
              <button ref={firstRef} onClick={() => setOpen(false)} aria-label="Close" className="text-brand-muted hover:text-brand-dark"><X className="w-5 h-5" /></button>
            </div>
            <dl className="text-sm space-y-1">
              <div className="flex justify-between gap-3"><dt className="text-brand-muted">League</dt><dd className="font-semibold text-brand-dark text-right">{opp.leagueName}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-brand-muted">When</dt><dd className="text-brand-dark text-right">{dateLabel(opp)}</dd></div>
              {opp.venueName && <div className="flex justify-between gap-3"><dt className="text-brand-muted">Where</dt><dd className="text-brand-dark text-right">{opp.venueName}</dd></div>}
              <div className="flex justify-between gap-3"><dt className="text-brand-muted">Format</dt><dd className="text-brand-dark text-right">{formatLabel(opp.leagueFormat)}</dd></div>
              {opp.recommended && <div className="flex justify-between gap-3"><dt className="text-brand-muted">Level</dt><dd className="text-brand-dark text-right">{opp.recommended.replace('Recommended rating: ', '')}{opp.userRating != null ? ` · you: ${opp.userRating}` : ''}</dd></div>}
            </dl>
            {opp.ratingWarning && <p className="text-xs font-medium text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-lg px-2 py-1">{opp.ratingWarning}</p>}
            <p className="text-[11px] text-brand-muted">You&apos;ll be added as the substitute for this session. Your results count according to the league&apos;s substitute rules.</p>
            <button onClick={accept} disabled={busy} aria-busy={busy} className="w-full rounded-2xl bg-brand-dark px-4 py-3 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60">
              {busy ? 'Confirming…' : 'Confirm — I can sub'}
            </button>
            <Link href={opp.detailUrl} className="block text-center text-xs font-medium text-brand-muted hover:text-brand-dark">View league</Link>
            {error && <p role="alert" className="text-xs font-medium text-red-600">{error}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
