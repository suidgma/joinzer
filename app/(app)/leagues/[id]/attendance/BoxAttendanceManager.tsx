'use client'

import { useState } from 'react'
import AttendanceGrid from '@/components/features/leagues/AttendanceGrid'
import PlayerCombobox from '@/components/ui/PlayerCombobox'
import { buildAttendeeRows, type AttendeeInput } from '@/lib/leagues/attendance'
import type { LeagueAttendanceStatus } from '@/lib/types'

// One entrant/sub in the box attendance surface. `rowId` is the grid key:
// registration_id for box members, attendance row id for subs/guests.
export type BoxAttendee = {
  rowId: string
  attendanceId: string | null
  registrationId: string | null
  /** Doubles roster rows: the partner's registration — the team's second slot. */
  partnerRegistrationId?: string | null
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
  doubles = false,
}: {
  leagueId: string
  periodId: string
  initialAttendees: BoxAttendee[]
  availableSubs: SubOption[]
  /** Doubles: a team is one entrant, so subbing it out takes a pair (SubA/SubB). */
  doubles?: boolean
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
          doubles={doubles}
          unassignedSubs={unassignedSubs}
          availableSubs={availableSubs}
          onClose={() => setAssignFor(null)}
          onAssigned={(newSubs) => {
            setAttendees((list) => {
              const coveredRegId = assignFor.registrationId
              const newIds = new Set(newSubs.map((s) => s.rowId))
              // A pair (re)assignment replaces prior covers — unassign any old sub
              // still pointing at this member that isn't part of the new set.
              let next = list.map((a) =>
                a.kind !== 'roster' && coveredRegId && a.subbingForRegistrationId === coveredRegId && !newIds.has(a.rowId)
                  ? { ...a, subbingForRegistrationId: null }
                  : a,
              )
              for (const s of newSubs) {
                next = next.some((a) => a.rowId === s.rowId)
                  ? next.map((a) => (a.rowId === s.rowId ? s : a))
                  : [...next, s]
              }
              return next.map((a) => (a.rowId === assignFor.rowId ? { ...a, status: 'has_sub' as const } : a))
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
// Doubles: a team is one entrant with two slots. Sub out both players (whole team
// out) or just one (the other is present) — each pick links to that player's own
// registration, so the team renders per slot ("SubA/SubB" or "SubA/PresentPartner").
function AssignSubModal({
  leagueId, periodId, member, doubles, unassignedSubs, availableSubs, onClose, onAssigned, setBusy,
}: {
  leagueId: string
  periodId: string
  member: BoxAttendee
  doubles: boolean
  unassignedSubs: BoxAttendee[]
  availableSubs: SubOption[]
  onClose: () => void
  onAssigned: (subs: BoxAttendee[]) => void
  setBusy: (b: boolean) => void
}) {
  // already-in-cycle unassigned subs + not-yet-added registered players
  const options = [
    ...unassignedSubs.map((s) => ({ value: `att:${s.attendanceId}`, name: s.displayName, inCycle: true })),
    ...availableSubs.map((s) => ({ value: `user:${s.userId}`, name: s.name, inCycle: false })),
  ]
  const [value, setValue] = useState('')
  const [value2, setValue2] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Two slots only when we know both player registrations. Each slot is optional —
  // leave one empty when that player is here — but at least one is required.
  const canPair = doubles && !!member.registrationId && !!member.partnerRegistrationId
  const nameOfValue = (v: string) => options.find((o) => o.value === v)?.name ?? 'Sub'
  const toChoice = (v: string) => (v.startsWith('att:') ? { subAttendanceId: v.slice(4) } : { subUserId: v.slice(5) })

  // Label each picker with the player it replaces ("A/B" → "Sub for A" / "Sub for B").
  const parts = member.displayName.split('/')
  const label1 = parts[0] ? `Sub for ${parts[0]}` : 'Replacement 1'
  const label2 = parts[1] ? `Sub for ${parts[1]}` : 'Replacement 2'

  const canSubmit = canPair ? !!(value || value2) : !!value

  async function assign() {
    if (!canSubmit) return
    setSaving(true); setBusy(true); setErr(null)

    let body: Record<string, unknown>
    let values: string[]
    if (canPair) {
      const slots = [
        { forRegistrationId: member.registrationId as string, value },
        { forRegistrationId: member.partnerRegistrationId as string, value: value2 },
      ].filter((s) => s.value)
      values = slots.map((s) => s.value)
      body = {
        periodId,
        coveredRegistrationId: member.registrationId,
        slotRegistrationIds: [member.registrationId, member.partnerRegistrationId],
        subs: slots.map((s) => ({ ...toChoice(s.value), forRegistrationId: s.forRegistrationId })),
      }
    } else {
      values = [value]
      body = { periodId, coveredRegistrationId: member.registrationId, ...toChoice(value) }
    }

    try {
      const res = await fetch(`/api/leagues/${leagueId}/attendance/assign-sub`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      const rows: any[] | null = canPair ? (data.subs ?? null) : (data.sub ? [data.sub] : null)
      if (!res.ok || !rows) { setErr(data.error ?? 'Failed to assign'); setSaving(false); setBusy(false); return }
      onAssigned(rows.map((row, i) => ({
        rowId: row.id,
        attendanceId: row.id,
        registrationId: row.registration_id ?? null,
        kind: (row.registration_id || row.user_id ? 'sub' : 'guest') as BoxAttendee['kind'],
        displayName: nameOfValue(values[i]),
        status: row.status,
        // Group under the team's box row so the grid shows every cover on one row.
        subbingForRegistrationId: member.registrationId,
      })))
    } catch {
      setErr('Network error')
    }
    setSaving(false); setBusy(false)
  }

  const optionList = (exclude?: string) =>
    options.filter((o) => o.value !== exclude).map((o) => (
      <option key={o.value} value={o.value}>{o.name}{o.inCycle ? ' (already here)' : ''}</option>
    ))

  return (
    <ModalShell title={canPair ? 'Assign Subs' : 'Assign Sub'} subtitle={`Covering for ${member.displayName}`} onClose={onClose}>
      {options.length < 1 ? (
        <p className="text-sm text-brand-muted">No available players to assign.</p>
      ) : canPair ? (
        <div className="space-y-3">
          <p className="text-[11px] text-brand-muted">Leave a slot empty if that player is here.</p>
          <div className="space-y-1">
            <p className="text-xs font-medium text-brand-muted">{label1}</p>
            <select autoFocus value={value} onChange={(e) => setValue(e.target.value)} className="w-full input text-sm">
              <option value="">— Here / no sub —</option>
              {optionList(value2)}
            </select>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-brand-muted">{label2}</p>
            <select value={value2} onChange={(e) => setValue2(e.target.value)} className="w-full input text-sm">
              <option value="">— Here / no sub —</option>
              {optionList(value)}
            </select>
          </div>
        </div>
      ) : (
        <PlayerCombobox
          autoFocus
          options={options.map((o) => ({ id: o.value, name: o.inCycle ? `${o.name} (already here)` : o.name }))}
          value={value}
          onChange={setValue}
          placeholder="Type a player's name…"
          emptyText="No available players"
        />
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <ModalButtons onClose={onClose} onConfirm={assign} confirmLabel={saving ? 'Assigning…' : 'Assign'} disabled={saving || !canSubmit} />
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
        <PlayerCombobox
          autoFocus
          options={availableSubs.map((s) => ({ id: s.userId, name: s.name }))}
          value={userId}
          onChange={setUserId}
          placeholder="Type a player's name…"
        />
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
