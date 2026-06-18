'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Clock } from 'lucide-react'
import type { OrgMatch, OrgRegistration, OrgDivision } from './types'
import { slotLabel } from './ScoreEntryModal'
import RescheduleModal from './RescheduleModal'
import { Toast, useToast } from './Toast'

type View = 'time' | 'court' | 'division'
type ShowCol = 'date' | 'time' | 'court' | 'division'

function fmtClock(d: Date): string {
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
  })
}

/** "1:00 – 2:00 AM" when an end time exists, else just the start "1:00 AM". */
function fmtTimeRange(iso: string | null, endIso?: string | null): string {
  if (!iso) return '—'
  const start = new Date(iso)
  if (!endIso) return fmtClock(start)
  return `${fmtClock(start)} – ${fmtClock(new Date(endIso))}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'Unscheduled'
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles',
  })
}

/** Compact date like "MON 6/22" for per-row display in court/division views. */
function fmtDateShort(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' }).toUpperCase()
  const md = d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'America/Los_Angeles' })
  return `${wd} ${md}`
}

const STATUS_BADGE: Record<string, string> = {
  completed: 'bg-brand-soft text-brand-active',
  in_progress: 'bg-yellow-50 text-yellow-700',
  pending: 'bg-gray-100 text-gray-500',
  ready: 'bg-blue-50 text-blue-700',
}

type Props = {
  tournamentId: string
  matches: OrgMatch[]
  registrations: OrgRegistration[]
  divisions: OrgDivision[]
  onMatchUpdate: (updated: OrgMatch) => void
}

export default function ScheduleTab({ tournamentId, matches, registrations, divisions, onMatchUpdate }: Props) {
  const [view, setView] = useState<View>('time')
  const [playerView, setPlayerView] = useState(false)
  const [reschedulingMatch, setReschedulingMatch] = useState<OrgMatch | null>(null)
  // Group keys are namespaced per view (e.g. "time:Mon, Jun 22"), so each view
  // keeps its own collapse state and keys never collide across views.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const { message: toastMsg, show: showToast } = useToast()

  function toggle(key: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const divisionName = (id: string) => divisions.find(d => d.id === id)?.name ?? 'Division'
  const sortByTime = (a: OrgMatch, b: OrgMatch) =>
    (a.scheduled_time ?? '~').localeCompare(b.scheduled_time ?? '~') ||
    (a.court_number ?? Infinity) - (b.court_number ?? Infinity) ||
    a.match_number - b.match_number

  function MatchRow({ m, show }: { m: OrgMatch; show: ShowCol[] }) {
    const t1 = slotLabel(m.team_1_registration_id, m.team_2_registration_id, m.status, registrations)
    const t2 = slotLabel(m.team_2_registration_id, m.team_1_registration_id, m.status, registrations)
    const badgeClass = STATUS_BADGE[m.status] ?? 'bg-gray-100 text-gray-500'
    const statusLabel = m.status === 'in_progress' ? 'Live' : m.status
    const canReschedule = !playerView && m.status !== 'completed'
    // Court stays an organizer-only detail in player view, matching the prior page.
    const showCourt = show.includes('court') && !playerView

    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        {show.includes('date') && <span className="w-20 shrink-0 text-brand-muted font-semibold tabular-nums">{fmtDateShort(m.scheduled_time)}</span>}
        {show.includes('time') && <span className="w-28 shrink-0 text-brand-muted tabular-nums">{fmtTimeRange(m.scheduled_time, m.scheduled_end_time)}</span>}
        {showCourt && <span className="w-12 shrink-0 text-brand-muted">{m.court_number != null ? `Ct ${m.court_number}` : '—'}</span>}
        <span className="flex-1 min-w-0 truncate text-brand-dark">
          {t1} <span className="text-brand-muted">vs</span> {t2}
        </span>
        {show.includes('division') && <span className="shrink-0 text-[10px] text-brand-muted truncate max-w-[35%]">{divisionName(m.division_id)}</span>}
        {m.status === 'completed' && m.team_1_score != null && (
          <span className="shrink-0 text-xs font-bold text-brand-dark tabular-nums">{m.team_1_score}–{m.team_2_score}</span>
        )}
        <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${badgeClass}`}>{statusLabel}</span>
        {canReschedule && (
          <button
            onClick={() => setReschedulingMatch(m)}
            className="shrink-0 p-1 text-brand-muted hover:text-brand-dark transition-colors"
            title="Reschedule"
          >
            <Clock size={13} />
          </button>
        )}
      </div>
    )
  }

  function Group({ groupKey, title, sub, matches, show }: { groupKey: string; title: string; sub?: string; matches: OrgMatch[]; show: ShowCol[] }) {
    const isCollapsed = collapsed.has(groupKey)
    return (
      <div className="bg-white rounded-xl border border-brand-border overflow-hidden">
        <button
          onClick={() => toggle(groupKey)}
          className={`w-full flex items-center justify-between gap-2 px-3 py-2 bg-brand-soft/40 text-left ${isCollapsed ? '' : 'border-b border-brand-border'}`}
        >
          <span className="text-xs font-bold text-brand-dark min-w-0 truncate">{title}</span>
          <div className="flex items-center gap-2 shrink-0">
            {sub && <span className="text-[10px] text-brand-muted">{sub}</span>}
            <span className="text-[10px] text-brand-muted">{isCollapsed ? '▶' : '▼'}</span>
          </div>
        </button>
        {!isCollapsed && (
          <div className="divide-y divide-brand-border">
            {matches.map(m => <MatchRow key={m.id} m={m} show={show} />)}
          </div>
        )}
      </div>
    )
  }

  // ── By time: group by date ─────────────────────────────────────────────────
  function byTime() {
    const map = new Map<string, OrgMatch[]>()
    for (const m of matches) {
      const key = fmtDate(m.scheduled_time)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    return Array.from(map.entries()).map(([date, ms]) => (
      <Group key={date} groupKey={`time:${date}`} title={date} sub={`${ms.length} matches`} matches={[...ms].sort(sortByTime)} show={['time', 'court', 'division']} />
    ))
  }

  // ── By court ───────────────────────────────────────────────────────────────
  function byCourt() {
    const map = new Map<string, OrgMatch[]>()
    for (const m of matches) {
      const key = m.court_number != null ? `Court ${m.court_number}` : 'Unassigned'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([court, ms]) => (
        <Group key={court} groupKey={`court:${court}`} title={court} sub={`${ms.length} matches`} matches={[...ms].sort(sortByTime)} show={['date', 'time', 'division']} />
      ))
  }

  // ── By division ────────────────────────────────────────────────────────────
  function byDivision() {
    const map = new Map<string, OrgMatch[]>()
    for (const m of matches) {
      if (!map.has(m.division_id)) map.set(m.division_id, [])
      map.get(m.division_id)!.push(m)
    }
    return Array.from(map.entries()).map(([divId, ms]) => (
      <Group
        key={divId}
        groupKey={`division:${divId}`}
        title={divisionName(divId)}
        sub={`${ms.length} matches`}
        matches={[...ms].sort(sortByTime)}
        show={['date', 'time', 'court']}
      />
    ))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">Schedule</h3>
        <button
          onClick={() => setPlayerView(v => !v)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
            playerView
              ? 'bg-brand-soft border-brand text-brand-active'
              : 'bg-white border-brand-border text-brand-muted hover:text-brand-dark'
          }`}
        >
          {playerView ? '👤 Player view on' : 'View as player'}
        </button>
      </div>

      {playerView && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2 text-xs text-yellow-800 font-medium">
          Viewing as player — organizer controls hidden
        </div>
      )}

      {matches.length > 0 && (
        <>
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

          <div className="space-y-2.5">
            {view === 'time' && byTime()}
            {view === 'court' && byCourt()}
            {view === 'division' && byDivision()}
          </div>
        </>
      )}

      {matches.length === 0 && !playerView && (
        <div className="bg-white rounded-xl border border-brand-border text-center py-12 px-4">
          <p className="text-2xl mb-2">📅</p>
          <p className="text-sm font-semibold text-brand-dark">No matches scheduled yet</p>
          <p className="text-xs text-brand-muted mt-1 mb-4 max-w-xs mx-auto">
            Once players have registered, set up courts and times in the Schedule Builder — or generate a single division’s bracket from its Manage page.
          </p>
          <Link
            href={`/tournaments/${tournamentId}/schedule/builder`}
            className="inline-block py-2 px-4 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover transition-colors"
          >
            Open Schedule Builder →
          </Link>
        </div>
      )}

      {matches.length === 0 && playerView && (
        <p className="text-sm text-brand-muted text-center py-10">No matches scheduled yet.</p>
      )}

      {reschedulingMatch && (
        <RescheduleModal
          tournamentId={tournamentId}
          match={reschedulingMatch}
          onClose={() => setReschedulingMatch(null)}
          onSaved={updated => { onMatchUpdate(updated); showToast('Match rescheduled') }}
          onError={showToast}
        />
      )}

      <Toast message={toastMsg} />
    </div>
  )
}
