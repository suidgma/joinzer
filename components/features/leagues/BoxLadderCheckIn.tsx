'use client'

import { useState } from 'react'
import AddSubForMe from '@/components/features/subs/AddSubForMe'
import UndoSubButton from '@/components/features/subs/UndoSubButton'

// league_attendance statuses a player can self-report.
type Status = 'coming' | 'present' | 'late' | 'cannot_attend'

const BUTTONS: { status: Status; label: string; active: string; inactive: string }[] = [
  { status: 'coming', label: "I'm coming", active: 'bg-brand text-brand-dark border-brand', inactive: 'bg-brand-surface text-brand-muted border-brand-border hover:border-brand' },
  { status: 'present', label: "I'm here", active: 'bg-brand-dark text-white border-brand-dark', inactive: 'bg-brand-surface text-brand-muted border-brand-border hover:border-brand-dark' },
  { status: 'late', label: "I'm running late", active: 'bg-yellow-100 text-yellow-800 border-yellow-300', inactive: 'bg-brand-surface text-brand-muted border-brand-border hover:border-yellow-300' },
  { status: 'cannot_attend', label: "I can't make it", active: 'bg-red-50 text-red-700 border-red-300', inactive: 'bg-brand-surface text-brand-muted border-brand-border hover:border-red-300' },
]

type Props = {
  leagueId: string
  periodId: string
  initialStatus: Status | null
  // Self-sub allowed before the period's matches are generated.
  allowSelfSub?: boolean
  currentUserId?: string
  activeSelfSub?: { id: string; nomineeName: string } | null
}

// Player self-check-in + self-sub for box / ladder leagues (unified league_attendance
// model). The player-run counterpart to the organizer's attendance grid.
export default function BoxLadderCheckIn({
  leagueId,
  periodId,
  initialStatus,
  allowSelfSub = false,
  currentUserId,
  activeSelfSub = null,
}: Props) {
  const [status, setStatus] = useState<Status | null>(initialStatus)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleStatusChange(newStatus: Status) {
    if (newStatus === status) return
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/leagues/${leagueId}/attendance/self`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'Failed to update')
      setSaving(false)
      return
    }
    setStatus(newStatus)
    setSaving(false)
  }

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
      <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">My status — tonight&apos;s session</p>

      <div className="grid grid-cols-2 gap-1.5">
        {BUTTONS.map(({ status: s, label, active, inactive }) => (
          <button
            key={s}
            onClick={() => handleStatusChange(s)}
            disabled={saving || !!activeSelfSub}
            className={`py-2 rounded-xl border text-xs font-semibold transition-colors disabled:opacity-50 ${status === s ? active : inactive}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* Direct-pick self-sub (before the period's matches are generated) */}
      {activeSelfSub ? (
        <UndoSubButton nominationId={activeSelfSub.id} nomineeName={activeSelfSub.nomineeName} />
      ) : (
        allowSelfSub && status === 'cannot_attend' && (
          <AddSubForMe
            surface="league"
            scope={{ leagueId, periodId }}
            currentUserId={currentUserId}
            caption="Your sub takes your spot for this session — your standing/credit stays with you."
          />
        )
      )}
    </div>
  )
}
