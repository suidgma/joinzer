'use client'
import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { GripVertical, AlertTriangle, ChevronDown } from 'lucide-react'
import type { ScheduleBlock } from '@/lib/types'
import type { BuilderDivision, DivisionStats } from './types'
import type { DivisionEstimate } from '@/lib/tournament/scheduleEstimates'
import { isDoublesFormat } from '@/lib/taxonomy/formats'

type Props = {
  division: BuilderDivision
  stats: DivisionStats
  estimate: DivisionEstimate
  blocks: ScheduleBlock[]
  onAssign: (blockId: string) => void
  dragging: boolean
}

const CATEGORY_LABELS: Record<string, string> = {
  men: 'Men', women: 'Women', mixed: 'Mixed', coed: 'Coed', open: 'Open',
}

// "Men Doubles", "Mixed Doubles", "Open Singles" — falls back to the format slug.
function eventType(d: BuilderDivision): string | null {
  const cat = d.category ? CATEGORY_LABELS[d.category] ?? null : null
  const tt = d.team_type === 'singles' ? 'Singles' : d.team_type === 'doubles' ? 'Doubles' : null
  if (cat && tt) return `${cat} ${tt}`
  if (cat) return cat
  if (tt) return tt
  if (d.format) return d.format.replace(/_/g, ' ')
  return null
}

function metaLine(d: BuilderDivision): string {
  const parts: string[] = []
  const et = eventType(d)
  if (et) parts.push(et)
  if (d.bracket_type) parts.push(d.bracket_type.replace(/_/g, ' '))
  if (d.skill_min != null || d.skill_max != null) {
    parts.push(d.skill_min != null && d.skill_max != null ? `${d.skill_min}–${d.skill_max}` : `${d.skill_min ?? d.skill_max}+`)
  }
  if (d.min_age != null || d.max_age != null) {
    parts.push(`age ${d.min_age ?? '0'}–${d.max_age ?? '∞'}`)
  }
  return parts.join(' · ')
}

export default function DivisionCard({ division, stats, estimate, blocks, onAssign, dragging }: Props) {
  const [assignOpen, setAssignOpen] = useState(false)
  const noTeams = stats.teamCount < 2
  // Singles divisions count players, not teams — label the unit accordingly.
  const isDoubles = division.team_type === 'doubles' || isDoublesFormat(division.format)
  const unit = isDoubles ? 'team' : 'player'
  const unitPlural = isDoubles ? 'teams' : 'players'
  // Drag handled by @dnd-kit (pointer/touch/keyboard); grip below is the handle.
  const { attributes, listeners, setNodeRef } = useDraggable({ id: division.id })

  return (
    <div
      ref={setNodeRef}
      className={`bg-white rounded-xl border p-3 transition-shadow ${
        dragging ? 'border-brand opacity-50' : 'border-brand-border hover:shadow-sm'
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...listeners}
          {...attributes}
          aria-label={`Drag ${division.name} to a block`}
          className="touch-none cursor-grab active:cursor-grabbing text-brand-muted/60 mt-0.5 shrink-0"
        >
          <GripVertical size={15} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-brand-dark truncate">{division.name}</p>
          <p className="text-[11px] text-brand-muted mt-0.5 capitalize">{metaLine(division)}</p>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-brand-muted">
            <span>{stats.teamCount} {stats.teamCount === 1 ? unit : unitPlural}</span>
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
              <AlertTriangle size={11} /> {stats.teamCount === 0 ? `No ${unitPlural} registered` : `Only 1 ${unit} — needs 2+`}
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
