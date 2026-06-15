'use client'
import { Pencil, Copy, Trash2, MapPin, Clock, X, AlertTriangle } from 'lucide-react'
import type { ScheduleBlock, ScheduleSettings } from '@/lib/types'
import { blockCapacity } from '@/lib/tournament/scheduleEstimates'

export type AssignedDivision = { id: string; name: string; matches: number | null }

type Props = {
  block: ScheduleBlock
  locationName: string | null
  settings: ScheduleSettings
  assigned: AssignedDivision[]
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onDropDivision: () => void
  onRemoveDivision: (divisionId: string) => void
  dragActive: boolean
}

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`
}

function fmtDate(d: string): string {
  const [y, mo, day] = d.split('-').map(Number)
  return new Date(y, mo - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function BlockCard({
  block, locationName, settings, assigned, onEdit, onDuplicate, onDelete, onDropDivision, onRemoveDivision, dragActive,
}: Props) {
  const cap = blockCapacity(block.court_numbers.length, block.start_time, block.end_time, settings)
  const noCourts = block.court_numbers.length === 0

  const assignedMatches = assigned.reduce((sum, d) => sum + (d.matches ?? 0), 0)
  const hasUnknown = assigned.some(d => d.matches == null)
  const over = assignedMatches > cap.matchCapacity
  const loadColor = assigned.length === 0
    ? 'text-brand-muted'
    : over ? 'text-amber-600' : 'text-brand-active'

  return (
    <div
      onDragOver={e => { e.preventDefault() }}
      onDrop={e => { e.preventDefault(); onDropDivision() }}
      className={`bg-white rounded-xl border p-4 space-y-3 transition-colors ${
        dragActive ? 'border-brand border-dashed bg-brand-soft/40' : 'border-brand-border'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-brand-dark truncate">{block.name}</p>
          <p className="text-xs text-brand-muted mt-0.5">{fmtDate(block.block_date)}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} title="Edit" className="p-1.5 text-brand-muted hover:text-brand-dark transition-colors"><Pencil size={14} /></button>
          <button onClick={onDuplicate} title="Duplicate" className="p-1.5 text-brand-muted hover:text-brand-dark transition-colors"><Copy size={14} /></button>
          <button onClick={onDelete} title="Delete" className="p-1.5 text-brand-muted hover:text-red-600 transition-colors"><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-muted">
        <span className="flex items-center gap-1"><Clock size={12} /> {fmtTime(block.start_time)} – {fmtTime(block.end_time)}</span>
        {locationName && <span className="flex items-center gap-1"><MapPin size={12} /> {locationName}</span>}
        <span>{block.court_numbers.length} {block.court_numbers.length === 1 ? 'court' : 'courts'}</span>
      </div>

      {noCourts && (
        <p className="flex items-center gap-1 text-[11px] text-amber-600 font-medium">
          <AlertTriangle size={11} /> No courts selected
        </p>
      )}

      {/* Assigned divisions */}
      <div className="space-y-1.5">
        {assigned.length === 0 ? (
          <div className={`rounded-lg border border-dashed py-3 text-center text-[11px] ${dragActive ? 'border-brand text-brand-active' : 'border-brand-border text-brand-muted'}`}>
            {dragActive ? 'Drop division here' : 'No divisions assigned — drag one here'}
          </div>
        ) : (
          assigned.map(d => (
            <div key={d.id} className="flex items-center justify-between gap-2 bg-brand-soft rounded-lg px-2.5 py-1.5">
              <span className="text-xs font-medium text-brand-dark truncate">{d.name}</span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-brand-muted">{d.matches == null ? 'n/a' : `~${d.matches}m`}</span>
                <button onClick={() => onRemoveDivision(d.id)} title="Unassign" className="text-brand-muted hover:text-red-600 transition-colors">
                  <X size={13} />
                </button>
              </span>
            </div>
          ))
        )}
      </div>

      {/* Load vs capacity */}
      <div className="border-t border-brand-border pt-2.5 flex items-center justify-between text-[11px]">
        <span className="text-brand-muted">Load / capacity</span>
        <span className={`font-bold tabular-nums ${loadColor}`}>
          {assignedMatches}{hasUnknown ? '+' : ''} / ~{cap.matchCapacity} matches
          {over && <span className="ml-1 font-semibold">· over by ~{assignedMatches - cap.matchCapacity}</span>}
        </span>
      </div>
    </div>
  )
}
