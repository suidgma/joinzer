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
  currentUserId: string
}

function dateStr(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function SubRequestsSection({ initialRequests, currentUserId }: Props) {
  const [requests, setRequests] = useState<SubRequest[]>(initialRequests)
  const [claiming, setClaiming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleClaim(id: string) {
    setClaiming(id)
    setError(null)

    const res = await fetch(`/api/league-sub-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'claim' }),
    })
    const d = await res.json()

    if (!res.ok) { setError(d.error ?? 'Failed to claim'); setClaiming(null); return }

    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'claimed' } : r))
    setClaiming(null)
  }

  if (requests.length === 0) return null

  return (
    <div className="space-y-3">
      <h2 className="font-heading text-base font-bold text-brand-dark">Open Sub Requests</h2>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="space-y-2">
        {requests.map(sr => {
          const isClaimed   = sr.status === 'claimed'
          const claimedByMe = sr.claimed_by?.name && isClaimed

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
                  {sr.notes && (
                    <p className="text-xs text-brand-body mt-1">{sr.notes}</p>
                  )}
                </div>
                <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                  isClaimed ? 'bg-yellow-100 text-yellow-700' : 'bg-brand-soft text-brand-active'
                }`}>
                  {isClaimed ? 'Claimed' : 'Open'}
                </span>
              </div>

              {!isClaimed && (
                <button
                  onClick={() => handleClaim(sr.id)}
                  disabled={claiming === sr.id}
                  className="w-full py-2 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
                >
                  {claiming === sr.id ? 'Claiming…' : 'I can sub →'}
                </button>
              )}

              {isClaimed && (
                <p className="text-xs text-yellow-700 font-medium">
                  {claimedByMe ? `${sr.claimed_by?.name} volunteered — waiting on organizer` : 'Volunteer found — pending approval'}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
