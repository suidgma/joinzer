'use client'
import { useState } from 'react'
import type { ScheduleBlock } from '@/lib/types'
import type { BuilderDivision, DraftMatch } from './types'

type View = 'time' | 'court' | 'division'

type Props = {
  draftMatches: DraftMatch[]
  blocks: ScheduleBlock[]
  divisions: BuilderDivision[]
  teamLabels: Record<string, string>
  matchDurationMinutes: number
}

function fmtClock(d: Date): string {
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
  })
}

/** "1:00 – 1:25 PM" — start to estimated end (start + match duration). */
function fmtRange(iso: string | null, durationMin: number): string {
  if (!iso) return '—'
  const start = new Date(iso)
  const end = new Date(start.getTime() + durationMin * 60000)
  return `${fmtClock(start)} – ${fmtClock(end)}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'Unscheduled'
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles',
  })
}

export default function SchedulePreview({ draftMatches, blocks, divisions, teamLabels, matchDurationMinutes }: Props) {
  const [view, setView] = useState<View>('time')

  const divisionName = (id: string) => divisions.find(d => d.id === id)?.name ?? 'Division'
  const label = (regId: string | null) => (regId ? teamLabels[regId] ?? 'TBD' : 'TBD')
  const sortByTime = (a: DraftMatch, b: DraftMatch) =>
    (a.scheduled_time ?? '~').localeCompare(b.scheduled_time ?? '~') || a.match_number - b.match_number

  function MatchRow({ m, show }: { m: DraftMatch; show: ('time' | 'court' | 'division')[] }) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        {show.includes('time') && <span className="w-28 shrink-0 text-brand-muted tabular-nums">{fmtRange(m.scheduled_time, matchDurationMinutes)}</span>}
        {show.includes('court') && <span className="w-12 shrink-0 text-brand-muted">{m.court_number != null ? `Ct ${m.court_number}` : '—'}</span>}
        <span className="flex-1 min-w-0 truncate text-brand-dark">
          {label(m.team_1_registration_id)} <span className="text-brand-muted">vs</span> {label(m.team_2_registration_id)}
        </span>
        {show.includes('division') && <span className="shrink-0 text-[10px] text-brand-muted truncate max-w-[40%]">{divisionName(m.division_id)}</span>}
      </div>
    )
  }

  function Group({ title, sub, matches, show }: { title: string; sub?: string; matches: DraftMatch[]; show: ('time' | 'court' | 'division')[] }) {
    return (
      <div className="bg-white rounded-xl border border-brand-border overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-brand-border bg-brand-soft/40">
          <span className="text-xs font-bold text-brand-dark">{title}</span>
          {sub && <span className="text-[10px] text-brand-muted">{sub}</span>}
        </div>
        <div className="divide-y divide-brand-border">
          {matches.map(m => <MatchRow key={m.id} m={m} show={show} />)}
        </div>
      </div>
    )
  }

  // ── By time: group by date ─────────────────────────────────────────────────
  function byTime() {
    const map = new Map<string, DraftMatch[]>()
    for (const m of draftMatches) {
      const key = fmtDate(m.scheduled_time)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    return Array.from(map.entries()).map(([date, ms]) => (
      <Group key={date} title={date} sub={`${ms.length} matches`} matches={[...ms].sort(sortByTime)} show={['time', 'court', 'division']} />
    ))
  }

  // ── By court ───────────────────────────────────────────────────────────────
  function byCourt() {
    const map = new Map<string, DraftMatch[]>()
    for (const m of draftMatches) {
      const key = m.court_number != null ? `Court ${m.court_number}` : 'Unassigned'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([court, ms]) => (
        <Group key={court} title={court} sub={`${ms.length} matches`} matches={[...ms].sort(sortByTime)} show={['time', 'division']} />
      ))
  }

  // ── By division ────────────────────────────────────────────────────────────
  function byDivision() {
    const map = new Map<string, DraftMatch[]>()
    for (const m of draftMatches) {
      if (!map.has(m.division_id)) map.set(m.division_id, [])
      map.get(m.division_id)!.push(m)
    }
    return Array.from(map.entries()).map(([divId, ms]) => (
      <Group
        key={divId}
        title={divisionName(divId)}
        sub={`${ms.length} matches`}
        matches={[...ms].sort((a, b) => (a.round_number ?? 0) - (b.round_number ?? 0) || a.match_number - b.match_number)}
        show={['time', 'court']}
      />
    ))
  }

  const unscheduled = draftMatches.filter(m => !m.scheduled_time || m.court_number == null).length

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 bg-white rounded-full border border-brand-border p-1 w-fit">
        {(['time', 'court', 'division'] as View[]).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors capitalize ${
              view === v ? 'bg-brand text-brand-dark' : 'text-brand-muted hover:text-brand-dark'
            }`}
          >
            By {v}
          </button>
        ))}
      </div>

      {unscheduled > 0 && (
        <p className="text-[11px] text-amber-700 font-medium">
          {unscheduled} match{unscheduled === 1 ? '' : 'es'} couldn’t be placed in a court/time slot.
        </p>
      )}

      <div className="space-y-2.5">
        {view === 'time' && byTime()}
        {view === 'court' && byCourt()}
        {view === 'division' && byDivision()}
      </div>
    </div>
  )
}
