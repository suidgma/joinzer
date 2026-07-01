'use client'
import { useState } from 'react'
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

export default function BlockFormModal({
  tournamentId, mode, block, days, locations, primaryLocationId, settings, onClose, onSaved, onError,
}: Props) {
  const firstDay = days[0]
  const initialLocationId = block?.location_id ?? primaryLocationId ?? locations[0]?.id ?? null
  const initialLocation = locations.find(l => l.id === initialLocationId)
  const initialCourtCount = initialLocation?.court_count ?? 1

  const [name, setName] = useState(block?.name ?? '')
  const [date, setDate] = useState(block?.block_date ?? firstDay?.date ?? '')
  const [startTime, setStartTime] = useState(toHHMM(block?.start_time ?? firstDay?.start_time))
  const [endTime, setEndTime] = useState(toHHMM(block?.end_time ?? firstDay?.end_time))
  const [locationId, setLocationId] = useState<string | null>(initialLocationId)
  const [courts, setCourts] = useState<number[]>(
    block?.court_numbers ?? Array.from({ length: initialCourtCount }, (_, i) => i + 1)
  )
  const [notes, setNotes] = useState(block?.notes ?? '')
  const [priority, setPriority] = useState<number>(block?.priority ?? 0)
  const [maxDivisions, setMaxDivisions] = useState<string>(
    block?.max_divisions != null ? String(block.max_divisions) : ''
  )
  const [saving, setSaving] = useState(false)

  const selectedLocation = locations.find(l => l.id === locationId)
  const courtCount = selectedLocation?.court_count ?? 0

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
    if (!startTime || !endTime || endTime <= startTime) { onError('End time must be after start time'); return }
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        block_date: date,
        start_time: startTime,
        end_time: endTime,
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
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Saturday Morning" className="w-full input" />
        </div>

        {cap && (
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
