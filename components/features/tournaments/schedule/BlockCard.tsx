'use client'
import { Pencil, Copy, Trash2, MapPin, Clock } from 'lucide-react'
import type { ScheduleBlock, ScheduleSettings } from '@/lib/types'
import { blockCapacity } from '@/lib/tournament/scheduleEstimates'

type Props = {
  block: ScheduleBlock
  locationName: string | null
  settings: ScheduleSettings
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hr = h % 12 === 0 ? 12 : h % 12
  return `${hr}:${String(m).padStart(2, '0')} ${ampm}`
}

function fmtDate(d: string): string {
  // d is 'YYYY-MM-DD' — render without timezone drift.
  const [y, mo, day] = d.split('-').map(Number)
  return new Date(y, mo - 1, day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function BlockCard({ block, locationName, settings, onEdit, onDuplicate, onDelete }: Props) {
  const cap = blockCapacity(block.court_numbers.length, block.start_time, block.end_time, settings)

  return (
    <div className="bg-white rounded-xl border border-brand-border p-4 space-y-3">
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
      </div>

      <div className="flex flex-wrap gap-1">
        {block.court_numbers.length > 0
          ? block.court_numbers.map(n => (
              <span key={n} className="h-6 min-w-6 px-1.5 inline-flex items-center justify-center rounded-md bg-brand-soft text-brand-active text-[11px] font-semibold">
                {n}
              </span>
            ))
          : <span className="text-[11px] text-amber-600 font-medium">No courts selected</span>}
      </div>

      <div className="border-t border-brand-border pt-2.5 flex items-center justify-between text-[11px]">
        <span className="text-brand-muted">Estimated capacity</span>
        <span className="font-bold text-brand-dark tabular-nums">~{cap.matchCapacity} matches</span>
      </div>
    </div>
  )
}
