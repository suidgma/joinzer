'use client'

import { useState } from 'react'
import { AlertTriangle, Link2Off } from 'lucide-react'
import type { DuplicateCandidate } from '@/lib/locations/duplicates'
import type { DetailEntry } from '@/lib/locations/venueDetailSummary'

export type PendingLocation = {
  id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  country: string | null
  creatorName: string | null
  candidates: DuplicateCandidate[]
  /** Only the fields the submitter actually answered — a skipped field is absent, never rendered
   *  as "Unknown" or "No". Distinguishing "they said no" from "they didn't say" is the point. */
  detail: DetailEntry[]
  notes: string | null
  hasListing: boolean
}

/**
 * Candidates now come from two pools with different vocabularies: `locations.status`
 * (approved/pending) and the namespaced `facility_listings` statuses the page assigns. Labelled
 * separately because "already live on /courts" and "another organizer also added this" call for
 * different decisions from the reviewer.
 */
const STATUS_LABEL: Record<string, string> = {
  approved: 'in pickers',
  pending: 'also pending',
  'in directory': 'live on /courts',
  'directory draft': 'directory draft',
}

const STATUS_STYLE: Record<string, string> = {
  approved: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-slate-100 text-slate-600',
  'in directory': 'bg-emerald-100 text-emerald-700',
  'directory draft': 'bg-sky-100 text-sky-700',
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
          <div key={l.id} className="border border-brand-border rounded-xl p-3 space-y-2">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-brand-dark">{l.name}</p>
                {addr && <p className="text-xs text-brand-muted">{addr}</p>}
                {l.creatorName && <p className="text-[11px] text-brand-muted mt-0.5">Added by {l.creatorName}</p>}
                {!l.hasListing && (
                  <p className="flex items-center gap-1 text-[11px] text-amber-700 mt-0.5">
                    <Link2Off className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                    No directory record — the listing write failed when this was submitted
                  </p>
                )}
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

            {(l.detail.length > 0 || l.notes) && (
              <div className="rounded-lg bg-brand-soft/50 border border-brand-border p-2.5">
                <p className="text-[11px] font-semibold text-brand-muted uppercase tracking-wide">
                  Submitted detail
                </p>
                {l.detail.length > 0 && (
                  <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
                    {l.detail.map((d) => (
                      <div key={d.label} className="flex gap-1.5 text-[11px] min-w-0">
                        <dt className="text-brand-muted flex-shrink-0">{d.label}</dt>
                        <dd className="text-brand-dark font-medium truncate">
                          {d.href ? (
                            <a
                              href={d.href}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              className="text-brand-active hover:underline"
                            >
                              {d.value}
                            </a>
                          ) : (
                            d.value
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {l.notes && (
                  <p className="mt-1.5 text-[11px] text-brand-body whitespace-pre-line">
                    <span className="text-brand-muted">Notes </span>
                    {l.notes}
                  </p>
                )}
              </div>
            )}

            {l.candidates.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  Possible duplicate{l.candidates.length > 1 ? 's' : ''} — review before approving
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {l.candidates.map((c) => (
                    <li key={c.id} className="text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-brand-dark">{c.name}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            STATUS_STYLE[c.status ?? ''] ?? 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {STATUS_LABEL[c.status ?? ''] ?? 'also pending'}
                        </span>
                      </div>
                      {c.addressLine && <p className="text-[11px] text-brand-muted">{c.addressLine}</p>}
                      <div className="flex gap-1 flex-wrap mt-0.5">
                        {c.reasons.map((r) => (
                          <span key={r} className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px]">
                            {r}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
