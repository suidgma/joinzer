'use client'

import { useState } from 'react'

type SubRequest = {
  id: string
  league_id: string
  league_session_id: string
  status: string
  notes: string | null
  requesting_player: { name: string } | null
  claimed_by: { name: string } | null
  session: { session_date: string; session_number: number } | null
  league: { name: string } | null
}

type Props = {
  initialRequests: SubRequest[]
  // Retained for call-site compatibility (Home passes it). The server RPC is the authority on
  // eligibility (incl. "can't accept your own"), so no client-side gating is needed here.
  currentUserId: string
}

function dateStr(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Phase 2: the "I can sub" action now calls the ATOMIC accept route, which claims the request and
// places the substitute in one transaction (no organizer approval). This is a minimal, honest
// surface — the full Home "Needs Your Attention" Action Center supersedes it in Phase 4.
export default function SubRequestsSection({ initialRequests }: Props) {
  const [requests, setRequests] = useState(initialRequests)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [doneName, setDoneName] = useState<string | null>(null)

  async function accept(sr: SubRequest) {
    setBusyId(sr.id)
    setErrors((e) => ({ ...e, [sr.id]: '' }))
    try {
      const res = await fetch(`/api/league-sub-requests/${sr.id}/accept`, { method: 'POST' })
      if (res.ok) {
        setDoneName(sr.requesting_player?.name ?? sr.league?.name ?? 'your spot')
        setRequests((rs) => rs.filter((r) => r.id !== sr.id))
        return
      }
      const body = await res.json().catch(() => ({}))
      setErrors((e) => ({ ...e, [sr.id]: body.error ?? 'Could not sub in. Try again.' }))
    } catch {
      setErrors((e) => ({ ...e, [sr.id]: 'Network error. Try again.' }))
    } finally {
      setBusyId(null)
    }
  }

  if (requests.length === 0) {
    if (doneName) {
      return (
        <div className="space-y-3">
          <div role="status" className="bg-brand-soft border border-brand-border rounded-2xl p-4 text-sm font-semibold text-brand-active">
            You&apos;re in! You&apos;re covering {doneName}. See you on the court. 🎾
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="space-y-3">
      <h2 className="font-heading text-base font-bold text-brand-dark">Open Sub Requests</h2>

      {doneName && (
        <div role="status" className="bg-brand-soft border border-brand-border rounded-2xl p-3 text-sm font-semibold text-brand-active">
          You&apos;re in! You&apos;re covering {doneName}. 🎾
        </div>
      )}

      <div className="space-y-2">
        {requests.map((sr) => {
          const busy = busyId === sr.id
          const err = errors[sr.id]
          return (
            <div key={sr.id} className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-brand-dark">
                    {sr.requesting_player?.name ?? 'Someone'} needs a sub
                  </p>
                  <p className="text-xs text-brand-muted">
                    {sr.league?.name}
                    {sr.session && ` · Session ${sr.session.session_number} · ${dateStr(sr.session.session_date)}`}
                  </p>
                  {sr.notes && <p className="text-xs text-brand-body mt-1">{sr.notes}</p>}
                </div>
                <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase bg-brand-soft text-brand-active">
                  Open
                </span>
              </div>

              <button
                type="button"
                onClick={() => accept(sr)}
                disabled={busy}
                aria-busy={busy}
                aria-label={`Sub in for ${sr.requesting_player?.name ?? 'this player'}`}
                className="w-full rounded-xl bg-brand-dark px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
              >
                {busy ? 'Confirming…' : 'I can sub'}
              </button>

              {err && (
                <p role="alert" className="text-xs font-medium text-red-600">
                  {err}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
