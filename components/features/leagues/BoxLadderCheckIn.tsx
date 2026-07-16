'use client'

import { useState } from 'react'
import SubDecisionSheet, { type CreatedRequest } from '@/components/features/leagues/SubDecisionSheet'
import RequesterSubStatus, { type RequesterRequest } from '@/components/features/leagues/RequesterSubStatus'

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
  // "Can I still request/change a sub?" — true only before the period's matches are generated.
  allowSelfSub?: boolean
  currentUserId?: string
  activeSubRequest?: RequesterRequest | null
  // Deprecated (Phase 3 replaced the sub_nominations self-sub); accepted for call-site compat, ignored.
  activeSelfSub?: { id: string; nomineeName: string } | null
}

// Player self-check-in + unified sub request for box / ladder leagues (league_attendance model).
export default function BoxLadderCheckIn({
  leagueId,
  periodId,
  initialStatus,
  allowSelfSub = false,
  currentUserId,
  activeSubRequest = null,
}: Props) {
  const [status, setStatus] = useState<Status | null>(initialStatus)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [request, setRequest] = useState<RequesterRequest | null>(activeSubRequest)
  const [showSheet, setShowSheet] = useState(false)

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
    if (newStatus === 'cannot_attend' && allowSelfSub && !request) setShowSheet(true)
  }

  function onCreated(r: CreatedRequest) {
    setRequest({ id: r.request_id, status: r.status, fulfillment_mode: r.fulfillment_mode, subName: r.subName })
    setShowSheet(false)
  }

  const showSubArea = allowSelfSub && status === 'cannot_attend'

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
      <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">My status — tonight&apos;s session</p>

      <div className="grid grid-cols-2 gap-1.5">
        {BUTTONS.map(({ status: s, label, active, inactive }) => (
          <button
            key={s}
            onClick={() => handleStatusChange(s)}
            disabled={saving}
            className={`py-2 rounded-xl border text-xs font-semibold transition-colors disabled:opacity-50 ${status === s ? active : inactive}`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {showSubArea && (
        request ? (
          <RequesterSubStatus request={request} onCancelled={() => setRequest(null)} />
        ) : (
          <button
            onClick={() => setShowSheet(true)}
            className="w-full py-2 rounded-xl border border-orange-300 bg-orange-50 text-orange-700 text-xs font-semibold hover:bg-orange-100 transition-colors"
          >
            Need a sub? →
          </button>
        )
      )}

      {showSheet && (
        <SubDecisionSheet
          leagueId={leagueId}
          scope={{ periodId }}
          currentUserId={currentUserId}
          onCreated={onCreated}
          onJustAbsent={() => { /* already cannot_attend */ }}
          onClose={() => setShowSheet(false)}
        />
      )}
    </div>
  )
}
