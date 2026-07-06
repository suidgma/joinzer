'use client'

import { useState } from 'react'
import AttendanceGrid from '@/components/features/leagues/AttendanceGrid'
import { buildAttendeeRows, type AttendeeInput } from '@/lib/leagues/attendance'
import type { LeagueAttendanceStatus } from '@/lib/types'

// One entrant/sub in the box attendance surface. `rowId` is the grid key:
// registration_id for box members, attendance row id for subs/guests.
export type BoxAttendee = {
  rowId: string
  attendanceId: string | null
  registrationId: string | null
  kind: 'roster' | 'sub' | 'guest'
  displayName: string
  status: LeagueAttendanceStatus
  teamName?: string
  subbingForRegistrationId: string | null
}

type SubOption = { userId: string; name: string }

export default function BoxAttendanceManager({
  leagueId,
  periodId,
  initialAttendees,
  availableSubs,
}: {
  leagueId: string
  periodId: string
  initialAttendees: BoxAttendee[]
  availableSubs: SubOption[]
}) {
  const [attendees, setAttendees] = useState<BoxAttendee[]>(initialAttendees)
  const [assignFor, setAssignFor] = useState<BoxAttendee | null>(null)
  const [showAddSub, setShowAddSub] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { roster, subs } = buildAttendeeRows(
    attendees.map<AttendeeInput>((a) => ({
      id: a.rowId,
      displayName: a.displayName,
      kind: a.kind,
      status: a.status,
      registrationId: a.registrationId,
      subbingForRegistrationId: a.subbingForRegistrationId,
      teamName: a.teamName,
    })),
  )

  // Subs already added but not yet assigned to anyone — offered in the assign modal.
  const unassignedSubs = attendees.filter(
    (a) => a.kind !== 'roster' && !a.subbingForRegistrationId &&
      (a.status === 'present' || a.status === 'coming' || a.status === 'late'),
  )

  async function setStatus(rowId: string, status: LeagueAttendanceStatus) {
    const target = attendees.find((a) => a.rowId === rowId)
    if (!target) return
    const prev = target.status
    setAttendees((list) => list.map((a) => (a.rowId === rowId ? { ...a, status } : a)))

    const payload = target.attendanceId
      ? { attendanceId: target.attendanceId, status }
      : { periodId, registrationId: target.registrationId, status }
    try {
      const res = await fetch(`/api/leagues/${leagueId}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setAttendees((list) => list.map((a) => (a.rowId === rowId ? { ...a, status: prev } : a)))
        setError(data.error ?? 'Failed to save')
        return
      }
      // A box member's row may have just been created — capture its id.
      if (data.attendance?.id) {
        setAttendees((list) => list.map((a) => (a.rowId === rowId ? { ...a, attendanceId: data.attendance.id } : a)))
      }
    } catch {
      setAttendees((list) => list.map((a) => (a.rowId === rowId ? { ...a, status: prev } : a)))
      setError('Network error — please retry')
    }
  }

  async function setAll(rowIds: string[], status: LeagueAttendanceStatus) {
    await Promise.all(rowIds.map((id) => setStatus(id, status)))
  }

  return (
    <div className="space-y-3">
      {/* Attendance section header — mirrors the round-robin live view. */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-base font-bold text-brand-dark">Attendance</h2>
        <button
          onClick={() => setShowAddSub(true)}
          className="text-xs bg-brand-soft border border-brand-border text-brand-active font-medium px-3 py-1 rounded-full hover:bg-brand-surface"
        >
          + Add Sub
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-start justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 text-xs flex-shrink-0">✕</button>
        </div>
      )}

      {attendees.length === 0 ? (
        <p className="text-sm text-brand-muted">No box members yet — seed boxes on the Roster screen.</p>
      ) : (
        <AttendanceGrid
          roster={roster}
          subs={subs}
          onSetStatus={setStatus}
          onSetAll={setAll}
          onAssignSub={(rowId) => {
            const member = attendees.find((a) => a.rowId === rowId)
            if (member) setAssignFor(member)
          }}
          disabled={busy}
        />
      )}

      {assignFor && (
        <AssignSubModal
          leagueId={leagueId}
          periodId={periodId}
          member={assignFor}
          unassignedSubs={unassignedSubs}
          availableSubs={availableSubs}
          onClose={() => setAssignFor(null)}
          onAssigned={(sub) => {
            setAttendees((list) => {
              const withSub = list.some((a) => a.rowId === sub.rowId)
                ? list.map((a) => (a.rowId === sub.rowId ? sub : a))
                : [...list, sub]
              return withSub.map((a) => (a.rowId === assignFor.rowId ? { ...a, status: 'has_sub' } : a))
            })
            setAssignFor(null)
          }}
          setBusy={setBusy}
        />
      )}

      {showAddSub && (
        <AddSubModal
          leagueId={leagueId}
          periodId={periodId}
          availableSubs={availableSubs.filter((s) => !attendees.some((a) => a.kind !== 'roster' && a.displayName === s.name))}
          onClose={() => setShowAddSub(false)}
          onAdded={(sub) => { setAttendees((list) => [...list, sub]); setShowAddSub(false) }}
          setBusy={setBusy}
        />
      )}
    </div>
  )
}

// ── Assign Sub ────────────────────────────────────────────────────────────────
function AssignSubModal({
  leagueId, periodId, member, unassignedSubs, availableSubs, onClose, onAssigned, setBusy,
}: {
  leagueId: string
  periodId: string
  member: BoxAttendee
  unassignedSubs: BoxAttendee[]
  availableSubs: SubOption[]
  onClose: () => void
  onAssigned: (sub: BoxAttendee) => void
  setBusy: (b: boolean) => void
}) {
  // already-in-cycle unassigned subs + not-yet-added registered players
  const options = [
    ...unassignedSubs.map((s) => ({ value: `att:${s.attendanceId}`, name: s.displayName, inCycle: true })),
    ...availableSubs.map((s) => ({ value: `user:${s.userId}`, name: s.name, inCycle: false })),
  ]
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function assign() {
    if (!value) return
    setSaving(true); setBusy(true); setErr(null)
    const selected = options.find((o) => o.value === value)!
    const body: Record<string, unknown> = { periodId, coveredRegistrationId: member.registrationId }
    if (value.startsWith('att:')) body.subAttendanceId = value.slice(4)
    else body.subUserId = value.slice(5)

    try {
      const res = await fetch(`/api/leagues/${leagueId}/attendance/assign-sub`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.sub) { setErr(data.error ?? 'Failed to assign'); setSaving(false); setBusy(false); return }
      const row = data.sub
      onAssigned({
        rowId: row.id,
        attendanceId: row.id,
        registrationId: row.registration_id ?? null,
        kind: row.registration_id || row.user_id ? 'sub' : 'guest',
        displayName: selected.name,
        status: row.status,
        subbingForRegistrationId: row.subbing_for_registration_id ?? member.registrationId,
      })
    } catch {
      setErr('Network error')
    }
    setSaving(false); setBusy(false)
  }

  return (
    <ModalShell title="Assign Sub" subtitle={`Covering for ${member.displayName}`} onClose={onClose}>
      {options.length === 0 ? (
        <p className="text-sm text-brand-muted">No available players to assign.</p>
      ) : (
        <select autoFocus value={value} onChange={(e) => setValue(e.target.value)} className="w-full input text-sm">
          <option value="">— Select a sub —</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.name}{o.inCycle ? ' (already here)' : ''}</option>
          ))}
        </select>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <ModalButtons onClose={onClose} onConfirm={assign} confirmLabel={saving ? 'Assigning…' : 'Assign'} disabled={saving || !value} />
    </ModalShell>
  )
}

// ── Add Sub ───────────────────────────────────────────────────────────────────
function AddSubModal({
  leagueId, periodId, availableSubs, onClose, onAdded, setBusy,
}: {
  leagueId: string
  periodId: string
  availableSubs: SubOption[]
  onClose: () => void
  onAdded: (sub: BoxAttendee) => void
  setBusy: (b: boolean) => void
}) {
  const [userId, setUserId] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function add() {
    if (!userId) return
    setSaving(true); setBusy(true); setErr(null)
    const selected = availableSubs.find((s) => s.userId === userId)!
    try {
      const res = await fetch(`/api/leagues/${leagueId}/attendance/sub`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ periodId, userId }),
      })
      const data = await res.json()
      if (!res.ok || !data.attendance) { setErr(data.error ?? 'Failed to add'); setSaving(false); setBusy(false); return }
      const row = data.attendance
      onAdded({
        rowId: row.id,
        attendanceId: row.id,
        registrationId: row.registration_id ?? null,
        kind: 'sub',
        displayName: selected.name,
        status: row.status,
        subbingForRegistrationId: null,
      })
    } catch {
      setErr('Network error')
    }
    setSaving(false); setBusy(false)
  }

  return (
    <ModalShell title="Add Sub" onClose={onClose}>
      {availableSubs.length === 0 ? (
        <p className="text-sm text-brand-muted">No available players to add.</p>
      ) : (
        <select autoFocus value={userId} onChange={(e) => setUserId(e.target.value)} className="w-full input text-sm">
          <option value="">— Select a player —</option>
          {availableSubs.map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}
        </select>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <ModalButtons onClose={onClose} onConfirm={add} confirmLabel={saving ? 'Adding…' : 'Add Sub'} disabled={saving || !userId} />
    </ModalShell>
  )
}

// ── Modal chrome ──────────────────────────────────────────────────────────────
function ModalShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="font-heading text-lg font-bold text-brand-dark">{title}</h2>
          {subtitle && <p className="text-sm text-brand-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

function ModalButtons({ onClose, onConfirm, confirmLabel, disabled }: { onClose: () => void; onConfirm: () => void; confirmLabel: string; disabled: boolean }) {
  return (
    <div className="flex gap-3">
      <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-brand-border text-sm font-medium text-brand-muted">Cancel</button>
      <button onClick={onConfirm} disabled={disabled} className="flex-1 py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold disabled:opacity-50">{confirmLabel}</button>
    </div>
  )
}
