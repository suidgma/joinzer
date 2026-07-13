'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type PendingNomination = {
  id: string
  requesterName: string
  nomineeName: string
  note?: string | null
}

// Shared organizer-facing inbox: approve or decline players' substitute nominations.
// Used by captains (play), league admins, and tournament organizers. Renders nothing
// when there are no pending requests.
export default function SubNominationsInbox({
  nominations,
  title = 'Sub requests',
}: {
  nominations: PendingNomination[]
  title?: string
}) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (nominations.length === 0) return null

  async function resolve(id: string, action: 'approve' | 'decline') {
    setBusyId(id)
    setError(null)
    const res = await fetch(`/api/sub-nominations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const json = await res.json().catch(() => ({}))
    setBusyId(null)
    if (res.ok) router.refresh()
    else setError(json.error ?? 'Could not resolve the request')
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 space-y-2">
      <h2 className="text-sm font-bold text-brand-dark">
        {title} ({nominations.length})
      </h2>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {nominations.map((n) => (
        <div key={n.id} className="bg-white border border-brand-border rounded-xl p-3 space-y-2">
          <p className="text-sm text-brand-dark">
            <span className="font-semibold">{n.requesterName}</span> wants{' '}
            <span className="font-semibold">{n.nomineeName}</span> to sub in for them.
          </p>
          {n.note && <p className="text-xs text-brand-muted italic">&ldquo;{n.note}&rdquo;</p>}
          <div className="flex gap-2">
            <button
              disabled={busyId === n.id}
              onClick={() => resolve(n.id, 'approve')}
              className="flex-1 py-2 rounded-lg bg-brand text-brand-dark text-sm font-semibold disabled:opacity-50 hover:bg-brand-hover transition-colors"
            >
              Approve
            </button>
            <button
              disabled={busyId === n.id}
              onClick={() => resolve(n.id, 'decline')}
              className="flex-1 py-2 rounded-lg bg-brand-soft text-brand-muted text-sm font-semibold disabled:opacity-50 hover:bg-brand-border transition-colors"
            >
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
