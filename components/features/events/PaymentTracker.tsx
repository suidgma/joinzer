'use client'

import { useState } from 'react'

type Participant = {
  id: string
  user_id: string
  participant_status: string
  payment_status: string
  profile: { name: string } | null
}

type Props = {
  eventId: string
  participants: Participant[]
  captainUserId: string
  isCaptain: boolean
  priceCents: number
}

const STATUS_STYLES: Record<string, string> = {
  free:   'bg-gray-100 text-gray-400',
  unpaid: 'bg-amber-100 text-amber-700',
  paid:   'bg-green-100 text-green-700',
  waived: 'bg-blue-100 text-blue-600',
}
const STATUS_LABELS: Record<string, string> = {
  free:   'Free',
  unpaid: 'Unpaid',
  paid:   'Paid',
  waived: 'Waived',
}

export default function PaymentTracker({ eventId, participants, captainUserId, isCaptain, priceCents }: Props) {
  const [statuses, setStatuses] = useState<Record<string, string>>(
    Object.fromEntries(participants.map((p) => [p.user_id, p.payment_status]))
  )
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const joined = participants.filter((p) => p.participant_status === 'joined')

  async function cycleStatus(userId: string) {
    const current = statuses[userId]
    // captain's own row is always free — skip
    if (userId === captainUserId) return
    const next = current === 'unpaid' ? 'paid' : current === 'paid' ? 'waived' : 'unpaid'
    setTogglingId(userId)
    try {
      const res = await fetch(`/api/events/${eventId}/participants/${userId}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_status: next }),
      })
      if (res.ok) setStatuses((prev) => ({ ...prev, [userId]: next }))
    } finally {
      setTogglingId(null)
    }
  }

  const paidCount = joined.filter((p) => statuses[p.user_id] === 'paid' || statuses[p.user_id] === 'waived' || p.user_id === captainUserId).length
  const isPaidSession = priceCents > 0

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-semibold text-brand-dark">
          Players ({joined.length})
        </h2>
        {isCaptain && isPaidSession && (
          <span className="text-xs text-brand-muted">{paidCount}/{joined.length} paid</span>
        )}
      </div>

      <ul className="space-y-2">
        {joined.map((p) => {
          const isCapt = p.user_id === captainUserId
          const status = isCapt ? 'free' : statuses[p.user_id] ?? p.payment_status
          const canToggle = isCaptain && isPaidSession && !isCapt

          return (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-brand-body truncate">{p.profile?.name ?? 'Unknown'}</span>
                {isCapt && (
                  <span className="text-xs text-brand-active bg-brand-soft px-1.5 py-0.5 rounded-full font-medium shrink-0">
                    Captain
                  </span>
                )}
              </div>

              {isPaidSession && (
                canToggle ? (
                  <button
                    onClick={() => cycleStatus(p.user_id)}
                    disabled={togglingId === p.user_id}
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 transition-opacity disabled:opacity-40 ${STATUS_STYLES[status] ?? STATUS_STYLES.unpaid}`}
                  >
                    {togglingId === p.user_id ? '…' : STATUS_LABELS[status] ?? status}
                  </button>
                ) : (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLES[status] ?? STATUS_STYLES.free}`}>
                    {STATUS_LABELS[status] ?? status}
                  </span>
                )
              )}
            </li>
          )
        })}
      </ul>

      {isCaptain && isPaidSession && (
        <p className="text-[10px] text-brand-muted">Tap a status to cycle: Unpaid → Paid → Waived</p>
      )}
    </div>
  )
}
