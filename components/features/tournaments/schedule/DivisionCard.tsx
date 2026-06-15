'use client'
import { useState } from 'react'
import { GripVertical, AlertTriangle, ChevronDown } from 'lucide-react'
import type { ScheduleBlock } from '@/lib/types'
import type { BuilderDivision, DivisionStats } from './types'
import type { DivisionEstimate } from '@/lib/tournament/scheduleEstimates'

type Props = {
  division: BuilderDivision
  stats: DivisionStats
  estimate: DivisionEstimate
  blocks: ScheduleBlock[]
  onAssign: (blockId: string) => void
  onDragStart: () => void
  onDragEnd: () => void
  dragging: boolean
}

function metaLine(d: BuilderDivision): string {
  const parts: string[] = []
  if (d.bracket_type) parts.push(d.bracket_type.replace(/_/g, ' '))
  if (d.skill_min != null || d.skill_max != null) {
    parts.push(d.skill_min != null && d.skill_max != null ? `${d.skill_min}–${d.skill_max}` : `${d.skill_min ?? d.skill_max}+`)
  }
  if (d.min_age != null || d.max_age != null) {
    parts.push(`age ${d.min_age ?? '0'}–${d.max_age ?? '∞'}`)
  }
  return parts.join(' · ')
}

export default function DivisionCard({ division, stats, estimate, blocks, onAssign, onDragStart, onDragEnd, dragging }: Props) {
  const [assignOpen, setAssignOpen] = useState(false)
  const noTeams = stats.teamCount < 2

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`bg-white rounded-xl border p-3 cursor-grab active:cursor-grabbing transition-shadow ${
        dragging ? 'border-brand opacity-50' : 'border-brand-border hover:shadow-sm'
      }`}
    >
      <div className="flex items-start gap-2">
        <GripVertical size={15} className="text-brand-muted/60 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-brand-dark truncate">{division.name}</p>
          <p className="text-[11px] text-brand-muted mt-0.5 capitalize">{metaLine(division)}</p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-brand-muted">
            <span>{stats.teamCount} {stats.teamCount === 1 ? 'team' : 'teams'}</span>
            <span>·</span>
            <span>{estimate.matches == null ? 'est. n/a' : `~${estimate.matches} matches`}</span>
            {estimate.courtMinutes != null && (
              <>
                <span>·</span>
                <span>~{Math.round(estimate.courtMinutes / 60 * 10) / 10}h court time</span>
              </>
            )}
          </div>

          {noTeams && (
            <p className="flex items-center gap-1 mt-1.5 text-[11px] text-amber-600 font-medium">
              <AlertTriangle size={11} /> {stats.teamCount === 0 ? 'No teams registered' : 'Only 1 team — needs 2+'}
            </p>
          )}

          {blocks.length > 0 && (
            <div className="relative mt-2">
              <button
                onClick={() => setAssignOpen(o => !o)}
                className="flex items-center gap-1 text-[11px] font-semibold text-brand-active hover:text-brand-dark transition-colors"
              >
                Assign to block <ChevronDown size={12} className={assignOpen ? 'rotate-180' : ''} />
              </button>
              {assignOpen && (
                <div className="absolute z-20 mt-1 w-48 bg-white rounded-lg border border-brand-border shadow-lg py-1">
                  {blocks.map(b => (
                    <button
                      key={b.id}
                      onClick={() => { onAssign(b.id); setAssignOpen(false) }}
                      className="block w-full text-left px-3 py-1.5 text-xs text-brand-dark hover:bg-brand-soft truncate"
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
