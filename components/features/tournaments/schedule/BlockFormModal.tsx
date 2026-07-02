'use client'
import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import type { ScheduleBlock, ScheduleSettings } from '@/lib/types'
import type { BuilderDay, BuilderLocation } from './types'
import { blockCapacity } from '@/lib/tournament/scheduleEstimates'

type Props = {
  tournamentId: string
  mode: 'create' | 'edit'
  block?: ScheduleBlock
  days: BuilderDay[]
  locations: BuilderLocation[]
  primaryLocationId: string | null
  settings: ScheduleSettings
  isRolling?: boolean
  onClose: () => void
  onSaved: (block: ScheduleBlock) => void
  onError: (msg: string) => void
}

const toHHMM = (t: string | undefined | null) => (t ? t.slice(0, 5) : '')

// Compact M/D label for a YYYY-MM-DD date, e.g. "2026-07-04" → "7/4". Parses the parts
// directly (no Date object) so it never shifts across the UTC boundary.
const shortDate = (iso: string): string => {
  const [y, mo, day] = iso.split('-').map(Number)
  return y && mo && day ? `${mo}/${day}` : iso
}

// Compact am/pm time label, e.g. "08:00" → "8am", "13:30" → "1:30pm".
const fmtTime = (hhmm: string): string => {
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h)) return ''
  const ampm = h < 12 ? 'am' : 'pm'
  const hr = h % 12 === 0 ? 12 : h % 12
  return m ? `${hr}:${String(m).padStart(2, '0')}${ampm}` : `${hr}${ampm}`
}

// Court label, collapsing contiguous runs into ranges: [1,2,3,4] → "Courts 1-4",
// [1] → "Court 1", [1,3,5] → "Courts 1, 3, 5".
const fmtCourts = (courts: number[]): string => {
  if (courts.length === 0) return ''
  const sorted = [...courts].sort((a, b) => a - b)
  const parts: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i]
    if (n === prev + 1) { prev = n; continue }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`)
    start = n
    prev = n
  }
  return `${courts.length === 1 ? 'Court' : 'Courts'} ${parts.join(', ')}`
}

// Auto block name from the block's own fields, e.g. "7/4, 8am-11am, Courts 1-4".
const autoBlockName = (date: string, start: string, end: string, courts: number[]): string => {
  const d = date ? shortDate(date) : ''
  const t = start && end ? `${fmtTime(start)}-${fmtTime(end)}` : start ? fmtTime(start) : ''
  return [d, t, fmtCourts(courts)].filter(Boolean).join(', ')
}

export default function BlockFormModal({
  tournamentId, mode, block, days, locations, primaryLocationId, settings, isRolling, onClose, onSaved, onError,
}: Props) {
  const firstDay = days[0]
  const initialLocationId = block?.location_id ?? primaryLocationId ?? locations[0]?.id ?? null
  const initialLocation = locations.find(l => l.id === initialLocationId)
  const initialCourtCount = initialLocation?.court_count ?? 1

  const initialDate = block?.block_date ?? firstDay?.date ?? ''
  const initialStart = toHHMM(block?.start_time ?? firstDay?.start_time)
  const initialEnd = toHHMM(block?.end_time ?? firstDay?.end_time)
  const initialCourts = block?.court_numbers ?? Array.from({ length: initialCourtCount }, (_, i) => i + 1)
  const initialName = block?.name ?? ''

  const [name, setName] = useState(initialName)
  // The name auto-derives from date/time/courts (in create AND edit) and keeps syncing until the
  // organizer types their own. "Their own" = a non-empty name that differs from what auto-naming
  // would produce, so an empty or already-auto name still updates as the fields change; a genuine
  // custom name is preserved.
  const [nameTouched, setNameTouched] = useState(
    initialName.trim() !== '' && initialName !== autoBlockName(initialDate, initialStart, initialEnd, initialCourts)
  )
  const [date, setDate] = useState(initialDate)
  const [startTime, setStartTime] = useState(initialStart)
  const [endTime, setEndTime] = useState(initialEnd)
  const [locationId, setLocationId] = useState<string | null>(initialLocationId)
  const [courts, setCourts] = useState<number[]>(initialCourts)
  const [notes, setNotes] = useState(block?.notes ?? '')
  const [priority, setPriority] = useState<number>(block?.priority ?? 0)
  const [maxDivisions, setMaxDivisions] = useState<string>(
    block?.max_divisions != null ? String(block.max_divisions) : ''
  )
  const [saving, setSaving] = useState(false)

  const selectedLocation = locations.find(l => l.id === locationId)
  const courtCount = selectedLocation?.court_count ?? 0

  // Keep the auto name in sync with the fields until the organizer overrides it.
  useEffect(() => {
    if (!nameTouched) setName(autoBlockName(date, startTime, endTime, courts))
  }, [nameTouched, date, startTime, endTime, courts])

  function onDateChange(newDate: string) {
    setDate(newDate)
    // In create mode, prefill the window from the matching tournament day.
    if (mode === 'create') {
      const day = days.find(d => d.date === newDate)
      if (day) { setStartTime(toHHMM(day.start_time)); setEndTime(toHHMM(day.end_time)) }
    }
  }

  function onLocationChange(newId: string) {
    setLocationId(newId)
    const loc = locations.find(l => l.id === newId)
    // Default to all courts at the newly selected venue.
    setCourts(loc ? Array.from({ length: loc.court_count }, (_, i) => i + 1) : [])
  }

  function toggleCourt(n: number) {
    setCourts(cs => (cs.includes(n) ? cs.filter(c => c !== n) : [...cs, n].sort((a, b) => a - b)))
  }

  const cap = startTime && endTime && endTime > startTime
    ? blockCapacity(courts.length, startTime, endTime, settings)
    : null

  const dateOutOfRange = !!date && !days.some(d => d.date === date)

  async function save() {
    if (!name.trim()) { onError('Block name is required'); return }
    if (!date) { onError('Pick a date'); return }
    if (dateOutOfRange) { onError("Pick a date within your tournament's dates"); return }
    if (!startTime) { onError('Pick a start time'); return }
    // Rolling ignores the end time, but the column is NOT NULL with end > start — keep a
    // valid placeholder. Timed still requires a real end after the start.
    const endForPayload = isRolling ? (endTime > startTime ? endTime : '23:59') : endTime
    if (!isRolling && (!endTime || endTime <= startTime)) { onError('End time must be after start time'); return }
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        block_date: date,
        start_time: startTime,
        end_time: endForPayload,
        location_id: locationId,
        court_numbers: courts,
        notes: notes.trim() || null,
        priority,
        max_divisions: maxDivisions.trim() === '' ? null : Math.max(1, Number(maxDivisions) || 1),
      }
      const url = mode === 'create'
        ? `/api/tournaments/${tournamentId}/schedule-blocks`
        : `/api/tournaments/${tournamentId}/schedule-blocks/${block!.id}`
      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) { onError(json.error ?? 'Failed to save block'); return }
      onSaved(json.block as ScheduleBlock)
      onClose()
    } catch {
      onError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-sm font-bold text-brand-dark">
            {mode === 'create' ? 'New schedule block' : 'Edit block'}
          </h2>
          <button onClick={onClose} className="p-1 text-brand-muted hover:text-brand-dark"><X size={16} /></button>
        </div>

        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1">Date</label>
          {/* Always a select over the tournament's own dates so a block can't be
              scheduled outside the event. An existing out-of-range date (e.g. a
              legacy block) is shown as a flagged option so the organizer can fix it. */}
          <select value={date} onChange={e => onDateChange(e.target.value)} className="w-full input">
            {dateOutOfRange && <option value={date}>{shortDate(date)} — outside tournament dates</option>}
            {days.map(d => <option key={d.date} value={d.date}>{shortDate(d.date)}</option>)}
          </select>
          {dateOutOfRange && (
            <p className="mt-1 text-[11px] text-amber-600">This date is outside your tournament’s dates — pick a listed date.</p>
          )}
        </div>

        {/* Rolling needs a first-round start time but no end time — the matches roll on
            as courts free up. (end_time is NOT NULL with a check constraint, so a valid
            placeholder is still sent on save.) Timed shows both. */}
        {isRolling ? (
          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">First matches start at</label>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full input" />
            <p className="mt-1 text-[11px] text-brand-muted">After the first round, matches are called by Match&nbsp;# as courts free up — no end time needed.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Start</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full input" />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">End</label>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-full input" />
            </div>
          </div>
        )}

        {locations.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Venue</label>
            <select value={locationId ?? ''} onChange={e => onLocationChange(e.target.value)} className="w-full input">
              {locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.court_count} courts)</option>)}
            </select>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-brand-muted">
              Courts ({courts.length} of {courtCount} selected)
            </label>
            {courtCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  setCourts(courts.length > 0 ? [] : Array.from({ length: courtCount }, (_, i) => i + 1))
                }
                className="text-xs font-medium text-brand-active hover:underline"
              >
                {courts.length > 0 ? 'Uncheck all' : 'Select all'}
              </button>
            )}
          </div>
          {courtCount > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: courtCount }, (_, i) => i + 1).map(n => {
                const on = courts.includes(n)
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => toggleCourt(n)}
                    className={`h-8 w-8 rounded-lg text-xs font-semibold border transition-colors ${
                      on ? 'bg-brand border-brand text-brand-dark' : 'bg-white border-brand-border text-brand-muted hover:bg-brand-soft'
                    }`}
                  >
                    {n}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-brand-muted">No venue/court data — set a primary venue on the tournament.</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1">Notes (optional)</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Championship court" className="w-full input" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Priority</label>
            <input
              type="number" min={0} value={priority}
              onChange={e => setPriority(Math.max(0, Number(e.target.value) || 0))}
              className="w-full input"
            />
            <p className="text-[10px] text-brand-muted mt-1">Higher shows first.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-muted mb-1">Max divisions (optional)</label>
            <input
              type="number" min={1} value={maxDivisions} placeholder="No limit"
              onChange={e => setMaxDivisions(e.target.value)}
              className="w-full input"
            />
            <p className="text-[10px] text-brand-muted mt-1">Warn if exceeded.</p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1">Block name</label>
          <input
            value={name}
            onChange={e => { setName(e.target.value); setNameTouched(e.target.value.trim().length > 0) }}
            placeholder="Auto-named from date, time & courts"
            className="w-full input"
          />
        </div>

        {!isRolling && cap && (
          <div className="bg-brand-soft rounded-xl px-3 py-2 text-[11px] text-brand-active font-medium">
            Estimated capacity: ~{cap.matchCapacity} matches
            <span className="text-brand-muted font-normal"> · {courts.length} courts × {cap.usableMinutes} min</span>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 py-2 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create block' : 'Save changes'}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-brand-border text-sm text-brand-muted hover:bg-brand-soft transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
