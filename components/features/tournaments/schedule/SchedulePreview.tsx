'use client'
import { useState } from 'react'
import { Pencil, RefreshCw, Check, X } from 'lucide-react'
import type { ScheduleBlock } from '@/lib/types'
import type { BuilderDivision, DraftMatch } from './types'
import { useDialog } from '@/components/ui/DialogProvider'

type View = 'time' | 'court' | 'division'
type ShowCol = 'date' | 'time' | 'court' | 'division' | 'match'

// The generate-schedule GET now returns a tournament-wide "Match #" per draft
// match. It isn't on the shared DraftMatch type (the page's initial fetch omits
// it), so extend locally — it's optional and only used in rolling mode.
type PreviewMatch = DraftMatch & { sequence_number?: number | null }

type Props = {
  draftMatches: DraftMatch[]
  blocks: ScheduleBlock[]
  divisions: BuilderDivision[]
  teamLabels: Record<string, string>
  matchDurationMinutes: number
  tournamentId: string
  isRolling?: boolean
  onMatchUpdated: (m: DraftMatch) => void
  onDraftRefresh: () => void | Promise<void>
  onFlash?: (msg: string) => void
}

function fmtClock(d: Date): string {
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
  })
}

/** "1:00 – 1:25 PM" — uses the stored end time, falling back to start + duration.
 *  Kept for the court-conflict warning, where the booked window is the point. */
function fmtRange(iso: string | null, endIso: string | null, durationMin: number): string {
  if (!iso) return '—'
  const start = new Date(iso)
  const end = endIso ? new Date(endIso) : new Date(start.getTime() + durationMin * 60000)
  return `${fmtClock(start)} – ${fmtClock(end)}`
}

/** Start time only, e.g. "1:00 PM" — the schedule list omits end times. */
function fmtStart(iso: string | null): string {
  if (!iso) return '—'
  return fmtClock(new Date(iso))
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'Unscheduled'
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles',
  })
}

/** Compact date like "MON 6/29" for per-row display in court/division views. */
function fmtDateShort(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' }).toUpperCase()
  const md = d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'America/Los_Angeles' })
  return `${wd} ${md}`
}

// Las Vegas is America/Los_Angeles (UTC-7 in season) — matches the offset the
// scheduler writes, so a hand-edited time renders at the value the organizer typed.
function buildIso(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00-07:00`
}

// The stored timestamp comes back as UTC. Convert to tournament-local (LA) date +
// HH:MM so the edit inputs show the same time the organizer sees in the rows —
// otherwise opening the editor shows UTC and saving shifts the match by the offset.
function laParts(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }),          // YYYY-MM-DD
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Los_Angeles' }),
  }
}

export default function SchedulePreview({
  draftMatches: draftMatchesProp, blocks, divisions, teamLabels, matchDurationMinutes,
  tournamentId, isRolling, onMatchUpdated, onDraftRefresh, onFlash,
}: Props) {
  const draftMatches = draftMatchesProp as PreviewMatch[]
  const { confirm } = useDialog()
  // 'time' is the first tab; in rolling mode it renders as "By Match #".
  const [view, setView] = useState<View>('time')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCourt, setEditCourt] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editTime, setEditTime] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [regenId, setRegenId] = useState<string | null>(null)

  const divisionName = (id: string) => divisions.find(d => d.id === id)?.name ?? 'Division'
  // A structural BYE is a match auto-completed with a winner but no opponent —
  // the same detection BracketView uses, so the preview and the bracket agree.
  const isByeMatch = (m: DraftMatch) =>
    m.status === 'completed' && !!m.team_1_registration_id && !m.team_2_registration_id
  // Empty slots read "BYE" on a bye match (named player auto-advances), else
  // "TBD" (an unresolved later-round feeder).
  const label = (regId: string | null, m: DraftMatch) =>
    regId ? teamLabels[regId] ?? 'TBD' : isByeMatch(m) ? 'BYE' : 'TBD'
  const blockOf = (m: DraftMatch) => blocks.find(b => b.id === m.schedule_block_id) ?? null
  const sortByTime = (a: DraftMatch, b: DraftMatch) =>
    (a.scheduled_time ?? '~').localeCompare(b.scheduled_time ?? '~') ||
    (a.court_number ?? Infinity) - (b.court_number ?? Infinity) ||
    a.match_number - b.match_number
  // Rolling mode: order by the tournament-wide sequence ("Match #"), courts next.
  const sortBySeq = (a: PreviewMatch, b: PreviewMatch) =>
    (a.sequence_number ?? Infinity) - (b.sequence_number ?? Infinity) ||
    (a.court_number ?? Infinity) - (b.court_number ?? Infinity) ||
    a.match_number - b.match_number
  const matchNumLabel = (m: PreviewMatch) =>
    m.sequence_number != null ? `#${m.sequence_number}` : `Match ${m.match_number}`

  function startEdit(m: DraftMatch) {
    setEditingId(m.id)
    setEditCourt(m.court_number != null ? String(m.court_number) : '')
    setEditTime(m.scheduled_time ? laParts(m.scheduled_time).time : '')
    setEditDate(m.scheduled_time ? laParts(m.scheduled_time).date : (blockOf(m)?.block_date ?? ''))
  }

  async function saveEdit(m: PreviewMatch) {
    const court = editCourt.trim() === '' ? null : parseInt(editCourt, 10)
    if (court != null && (!Number.isInteger(court) || court < 1)) {
      onFlash?.('Enter a valid court number'); return
    }

    // Rolling mode: matches carry no clock time — only the court is editable, and
    // scheduled_time stays null (the PATCH route accepts nulls).
    if (isRolling) {
      setSavingId(m.id)
      try {
        const res = await fetch(`/api/tournaments/${tournamentId}/schedule`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates: [{ id: m.id, court_number: court, scheduled_time: null, scheduled_end_time: null }] }),
        })
        const json = await res.json()
        if (!res.ok) { onFlash?.(json.error ?? 'Failed to update match'); return }
        onMatchUpdated({ ...m, court_number: court, scheduled_time: null, scheduled_end_time: null })
        setEditingId(null)
      } catch {
        onFlash?.('Network error')
      } finally {
        setSavingId(null)
      }
      return
    }

    const date = editDate || (m.scheduled_time ? laParts(m.scheduled_time).date : blockOf(m)?.block_date ?? null)
    let scheduled_time = m.scheduled_time
    let scheduled_end_time = m.scheduled_end_time
    if (editTime && date) {
      scheduled_time = buildIso(date, editTime)
      const [h, mm] = editTime.split(':').map(Number)
      const endMin = h * 60 + mm + matchDurationMinutes
      const eh = String(Math.floor(endMin / 60) % 24).padStart(2, '0')
      const em = String(endMin % 60).padStart(2, '0')
      scheduled_end_time = buildIso(date, `${eh}:${em}`)
    }

    // Prevent double-booking: reject a court+time that overlaps another match on
    // the same court. Absolute timestamps cover the same-day check inherently.
    if (court != null && scheduled_time) {
      const newStart = new Date(scheduled_time).getTime()
      const newEnd = scheduled_end_time
        ? new Date(scheduled_end_time).getTime()
        : newStart + matchDurationMinutes * 60000
      const clash = draftMatches.find(o => {
        if (o.id === m.id || o.court_number !== court || !o.scheduled_time) return false
        const os = new Date(o.scheduled_time).getTime()
        const oe = o.scheduled_end_time
          ? new Date(o.scheduled_end_time).getTime()
          : os + matchDurationMinutes * 60000
        return newStart < oe && os < newEnd
      })
      if (clash) {
        onFlash?.(
          `Court ${court} is already booked ${fmtRange(clash.scheduled_time, clash.scheduled_end_time, matchDurationMinutes)} ` +
          `(${label(clash.team_1_registration_id, clash)} vs ${label(clash.team_2_registration_id, clash)}). Pick another court or time.`
        )
        return
      }
    }

    setSavingId(m.id)
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [{ id: m.id, court_number: court, scheduled_time, scheduled_end_time }] }),
      })
      const json = await res.json()
      if (!res.ok) { onFlash?.(json.error ?? 'Failed to update match'); return }
      onMatchUpdated({ ...m, court_number: court, scheduled_time, scheduled_end_time })
      setEditingId(null)
    } catch {
      onFlash?.('Network error')
    } finally {
      setSavingId(null)
    }
  }

  async function regenerate(divId: string, opts: { replacePublished?: boolean } = {}) {
    setRegenId(divId)
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/generate-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ divisionId: divId, force: true, replacePublished: !!opts.replacePublished }),
      })
      const json = await res.json()
      if (res.status === 409 && json.error === 'published_exists') {
        const n = json.publishedCount
        if (await confirm({
          title: 'Replace the live schedule?',
          body: `${n} published (live) match${n === 1 ? '' : 'es'} exist for this block. Regenerating deletes them until you publish again.`,
          confirmLabel: 'Replace',
          danger: true,
        })) {
          await regenerate(divId, { replacePublished: true })
        }
        return
      }
      if (res.status === 409 && json.error === 'player_conflicts') {
        onFlash?.('Can’t regenerate — players in overlapping divisions. Resolve the conflicts, or set player conflicts to “Warnings”.')
        return
      }
      if (!res.ok) { onFlash?.(json.error ?? 'Failed to regenerate'); return }
      // POST returns a lean summary — refetch the draft so the preview updates.
      await onDraftRefresh()
      onFlash?.(`Regenerated — ${json.generated} match${json.generated === 1 ? '' : 'es'}${json.overflow ? `, ${json.overflow} past block end` : ''}`)
    } catch {
      onFlash?.('Network error')
    } finally {
      setRegenId(null)
    }
  }

  function MatchRow({ m, show, editable }: { m: PreviewMatch; show: ShowCol[]; editable?: boolean }) {
    if (editingId === m.id) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 text-xs bg-brand-soft/40">
          {!isRolling && (
            <input
              type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
              className="w-32 shrink-0 border border-brand-border rounded px-1 py-0.5"
            />
          )}
          {!isRolling && (
            <input
              type="time" value={editTime} onChange={e => setEditTime(e.target.value)}
              className="w-24 shrink-0 border border-brand-border rounded px-1 py-0.5"
            />
          )}
          {isRolling && (
            <span className="w-14 shrink-0 whitespace-nowrap text-brand-muted font-semibold tabular-nums">{matchNumLabel(m)}</span>
          )}
          <span className="text-brand-muted">Ct</span>
          <input
            type="number" min={1} value={editCourt} onChange={e => setEditCourt(e.target.value)}
            placeholder="—" className="w-14 shrink-0 border border-brand-border rounded px-1 py-0.5 text-center"
          />
          <span className="flex-1 min-w-0 truncate text-brand-dark">
            {label(m.team_1_registration_id, m)} <span className="text-brand-muted">vs</span> {label(m.team_2_registration_id, m)}
          </span>
          <button
            onClick={() => saveEdit(m)} disabled={savingId === m.id}
            className="shrink-0 p-1 rounded text-brand-active hover:bg-brand-soft disabled:opacity-50"
            aria-label="Save"
          >
            {savingId === m.id ? '…' : <Check size={14} />}
          </button>
          <button
            onClick={() => setEditingId(null)}
            className="shrink-0 p-1 rounded text-brand-muted hover:bg-brand-soft"
            aria-label="Cancel"
          >
            <X size={14} />
          </button>
        </div>
      )
    }
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        {show.includes('match') && <span className="w-16 shrink-0 whitespace-nowrap text-brand-muted font-semibold tabular-nums">{matchNumLabel(m)}</span>}
        {show.includes('date') && <span className="w-20 shrink-0 whitespace-nowrap text-brand-muted font-semibold tabular-nums">{fmtDateShort(m.scheduled_time)}</span>}
        {show.includes('time') && <span className="w-20 shrink-0 whitespace-nowrap text-brand-muted tabular-nums">{fmtStart(m.scheduled_time)}</span>}
        {show.includes('court') && <span className="w-12 shrink-0 text-brand-muted">{m.court_number != null ? `Ct ${m.court_number}` : '—'}</span>}
        <span className="flex-1 min-w-0 truncate text-brand-dark">
          {label(m.team_1_registration_id, m)} <span className="text-brand-muted">vs</span> {label(m.team_2_registration_id, m)}
        </span>
        {show.includes('division') && <span className="shrink-0 text-[10px] text-brand-muted truncate max-w-[40%]">{divisionName(m.division_id)}</span>}
        {editable && (
          <button
            onClick={() => startEdit(m)}
            className="shrink-0 p-1 rounded text-brand-muted hover:text-brand-active hover:bg-brand-soft"
            aria-label="Edit court & time"
          >
            <Pencil size={12} />
          </button>
        )}
      </div>
    )
  }

  function Group({ title, sub, matches, show, editable, headerAction }: {
    title: string; sub?: string; matches: PreviewMatch[]; show: ShowCol[]
    editable?: boolean; headerAction?: React.ReactNode
  }) {
    return (
      <div className="bg-white rounded-xl border border-brand-border overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-brand-border bg-brand-soft/40">
          <span className="text-xs font-bold text-brand-dark min-w-0 truncate">{title}</span>
          <div className="flex items-center gap-3 shrink-0">
            {sub && <span className="text-[10px] text-brand-muted">{sub}</span>}
            {headerAction}
          </div>
        </div>
        <div className="divide-y divide-brand-border">
          {matches.map(m => <MatchRow key={m.id} m={m} show={show} editable={editable} />)}
        </div>
      </div>
    )
  }

  // ── By time: group by date ─────────────────────────────────────────────────
  function byTime() {
    const map = new Map<string, PreviewMatch[]>()
    for (const m of draftMatches) {
      const key = fmtDate(m.scheduled_time)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    return Array.from(map.entries()).map(([date, ms]) => (
      <Group key={date} title={date} sub={`${ms.length} matches`} matches={[...ms].sort(sortByTime)} show={['time', 'court', 'division']} editable />
    ))
  }

  // ── By Match #: one ordered list, no clock times (rolling mode) ─────────────
  function byMatchNumber() {
    const ms = [...draftMatches].sort(sortBySeq)
    return (
      <Group title="All matches" sub={`${ms.length} matches`} matches={ms} show={['match', 'court', 'division']} editable />
    )
  }

  // ── By court ───────────────────────────────────────────────────────────────
  function byCourt() {
    const map = new Map<string, PreviewMatch[]>()
    for (const m of draftMatches) {
      const key = m.court_number != null ? `Court ${m.court_number}` : 'Unassigned'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    }
    // Rolling mode: order rows by Match # and label them with it, no clock times.
    const sort = isRolling ? sortBySeq : sortByTime
    const show: ShowCol[] = isRolling ? ['match', 'division'] : ['date', 'time', 'division']
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([court, ms]) => (
        <Group key={court} title={court} sub={`${ms.length} matches`} matches={[...ms].sort(sort)} show={show} editable />
      ))
  }

  // ── By division: editable rows + per-division regenerate ───────────────────
  function byDivision() {
    const map = new Map<string, PreviewMatch[]>()
    for (const m of draftMatches) {
      if (!map.has(m.division_id)) map.set(m.division_id, [])
      map.get(m.division_id)!.push(m)
    }
    const sort = isRolling ? sortBySeq : sortByTime
    const show: ShowCol[] = isRolling ? ['match', 'court'] : ['date', 'time', 'court']
    return Array.from(map.entries()).map(([divId, ms]) => (
      <Group
        key={divId}
        title={divisionName(divId)}
        sub={`${ms.length} matches`}
        matches={[...ms].sort(sort)}
        show={show}
        editable
        headerAction={
          // Per-division Regenerate re-packs a block by time — meaningless without
          // clock times, so it's hidden in rolling mode.
          isRolling ? undefined : (
            <button
              onClick={() => regenerate(divId)}
              disabled={regenId != null}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-brand-active hover:underline disabled:opacity-50"
            >
              <RefreshCw size={11} className={regenId === divId ? 'animate-spin' : ''} />
              {regenId === divId ? 'Regenerating…' : 'Regenerate'}
            </button>
          )
        }
      />
    ))
  }

  // Rolling matches carry no clock time, so "unplaced" means only "no court yet".
  const unscheduled = isRolling
    ? draftMatches.filter(m => m.court_number == null).length
    : draftMatches.filter(m => !m.scheduled_time || m.court_number == null).length

  // In rolling mode the first tab is "By Match #"; otherwise the usual "By time".
  const tabLabel = (v: View) => (v === 'time' && isRolling ? 'By Match #' : `By ${v}`)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 bg-white rounded-full border border-brand-border p-1 w-fit">
        {(['time', 'court', 'division'] as View[]).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors ${v === 'time' && isRolling ? '' : 'capitalize'} ${
              view === v ? 'bg-brand text-brand-dark' : 'text-brand-muted hover:text-brand-dark'
            }`}
          >
            {tabLabel(v)}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-brand-muted">
        {isRolling
          ? 'Click ✎ on a match to change its court.'
          : `Click ✎ on a match to change its date, time, or court${view === 'division' ? ', or use Regenerate to rebuild a division’s draft.' : '.'}`}
      </p>

      {unscheduled > 0 && (
        <p className="text-[11px] text-amber-700 font-medium">
          {unscheduled} match{unscheduled === 1 ? '' : 'es'} {isRolling ? 'have no court assigned yet.' : 'couldn’t be placed in a court/time slot.'}
        </p>
      )}

      <div className="space-y-2.5">
        {view === 'time' && (isRolling ? byMatchNumber() : byTime())}
        {view === 'court' && byCourt()}
        {view === 'division' && byDivision()}
      </div>
    </div>
  )
}
