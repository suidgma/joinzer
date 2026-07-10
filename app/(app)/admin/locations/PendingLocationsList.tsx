'use client'

import { useState } from 'react'

export type PendingLocation = {
  id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  country: string | null
  creatorName: string | null
}

export default function PendingLocationsList({ initial }: { initial: PendingLocation[] }) {
  const [items, setItems] = useState(initial)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(id: string, action: 'approve' | 'reject') {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/locations/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? 'Something went wrong')
        return
      }
      setItems((prev) => prev.filter((l) => l.id !== id))
    } catch {
      setError('Network error — please retry')
    } finally {
      setBusyId(null)
    }
  }

  if (items.length === 0) {
    return <p className="text-sm text-brand-muted">No pending venues right now. 🎉</p>
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {items.map((l) => {
        const addr = [l.address, l.city, l.state, l.zip_code, l.country].filter(Boolean).join(', ')
        return (
          <div key={l.id} className="flex items-start gap-3 border border-brand-border rounded-xl p-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-brand-dark">{l.name}</p>
              {addr && <p className="text-xs text-brand-muted">{addr}</p>}
              {l.creatorName && <p className="text-[11px] text-brand-muted mt-0.5">Added by {l.creatorName}</p>}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => act(l.id, 'approve')}
                disabled={busyId === l.id}
                className="px-3 py-1.5 rounded-lg bg-brand text-brand-dark text-xs font-semibold hover:bg-brand-hover disabled:opacity-40 transition-colors"
              >
                {busyId === l.id ? '…' : 'Approve'}
              </button>
              <button
                onClick={() => act(l.id, 'reject')}
                disabled={busyId === l.id}
                className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 disabled:opacity-40 transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
