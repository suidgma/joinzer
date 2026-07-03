'use client'

// Shared, format-agnostic attendance grid.
//
// This is the differentiator UI (Here / Coming / Late / Can't Come / Sub / Not
// Here + substitute overlay) extracted from the round-robin LiveSessionManager so
// box leagues — and every future league type — render the identical grid. It is
// purely presentational: it takes normalized rows + callbacks and knows nothing
// about sessions, cycles, registrations, or how status is persisted.
//
// See docs/phases/unified-attendance.md.

import type { LeagueAttendanceStatus } from '@/lib/types'
import type { AttendeeRow } from '@/lib/leagues/attendance'

export type { AttendeeRow }

const ROSTER_STATUSES: { key: LeagueAttendanceStatus; label: string; sublabel?: string }[] = [
  { key: 'present',       label: 'Here' },
  { key: 'coming',        label: 'Coming' },
  { key: 'late',          label: 'Late' },
  { key: 'cannot_attend', label: "Can't",  sublabel: 'Come' },
  { key: 'has_sub',       label: 'Sub' },
  { key: 'not_present',   label: 'Not',    sublabel: 'Here' },
]

const SUB_STATUSES: { key: LeagueAttendanceStatus; label: string; sublabel?: string }[] = [
  { key: 'present',       label: 'Here' },
  { key: 'coming',        label: 'Coming' },
  { key: 'late',          label: 'Late' },
  { key: 'cannot_attend', label: "Can't",  sublabel: 'Come' },
  { key: 'not_present',   label: 'Not',    sublabel: 'Here' },
]

const ROW_BG: Record<LeagueAttendanceStatus, string> = {
  present:       'bg-brand/10',
  coming:        'bg-blue-50',
  late:          'bg-yellow-50',
  cannot_attend: 'bg-red-50/60',
  has_sub:       'bg-orange-50',
  not_present:   '',
}

type Props = {
  roster: AttendeeRow[]
  subs: AttendeeRow[]
  onSetStatus: (rowId: string, status: LeagueAttendanceStatus) => void
  onSetAll: (rowIds: string[], status: LeagueAttendanceStatus) => void
  /** Opens the assign-sub flow for a covered roster row. Omit to hide sub controls (read-only hosts). */
  onAssignSub?: (rowId: string) => void
  disabled?: boolean
}

// Group roster rows by team (fixed-partner). Matches LiveSessionManager's original
// ordering: teams sorted by name, members in input order, solo rows last.
function groupRoster(roster: AttendeeRow[]) {
  const hasTeams = roster.some((r) => r.teamName)
  if (!hasTeams) return roster.map((p) => ({ type: 'player' as const, p }))

  const solo: AttendeeRow[] = []
  const teamNames: string[] = []
  const seen = new Set<string>()
  for (const p of roster) {
    if (!p.teamName) { solo.push(p); continue }
    if (seen.has(p.teamName)) continue
    seen.add(p.teamName)
    teamNames.push(p.teamName)
  }
  teamNames.sort((a, b) => a.localeCompare(b))

  const items: Array<{ type: 'teamHeader'; teamName: string } | { type: 'player'; p: AttendeeRow }> = []
  for (const teamName of teamNames) {
    items.push({ type: 'teamHeader', teamName })
    for (const p of roster.filter((o) => o.teamName === teamName)) items.push({ type: 'player', p })
  }
  for (const p of solo) items.push({ type: 'player', p })
  return items
}

export default function AttendanceGrid({ roster, subs, onSetStatus, onSetAll, onAssignSub, disabled = false }: Props) {
  return (
    <>
      {/* Roster players — spreadsheet table */}
      {roster.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide mb-1.5">Roster Players</p>
          <div className="rounded-xl border border-brand-border overflow-hidden">
            {/* Header — click a column label to mark all players with that status */}
            <div className="grid grid-cols-[1fr_repeat(6,36px)] items-end bg-brand-soft border-b border-brand-border px-2 py-1.5 gap-x-1">
              <div>
                <span className="text-[9px] font-bold text-brand-muted uppercase tracking-wide">Player</span>
                <p className="text-[8px] text-brand-muted/60 leading-none mt-0.5">tap col → all</p>
              </div>
              {ROSTER_STATUSES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => onSetAll(roster.map((p) => p.id), s.key)}
                  disabled={disabled || roster.length === 0}
                  title={`Mark all as ${s.label}${s.sublabel ? ' ' + s.sublabel : ''}`}
                  className="text-[9px] font-bold text-brand-muted text-center leading-tight underline decoration-dotted underline-offset-2 hover:text-brand-active disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {s.label}{s.sublabel && <><br />{s.sublabel}</>}
                </button>
              ))}
            </div>
            {/* Render players — grouped by team for fixed-partner leagues */}
            {groupRoster(roster).map((item, idx, arr) => {
              if (item.type === 'teamHeader') {
                return (
                  <div key={`team-${item.teamName}`} className="px-2 py-1 bg-brand/10 border-b border-brand-border">
                    <p className="text-[10px] font-bold text-brand-dark uppercase tracking-wide">{item.teamName}</p>
                  </div>
                )
              }
              const p = item.p
              const isLast = idx === arr.length - 1
              return (
                <div key={p.id}>
                  <div className={`grid grid-cols-[1fr_repeat(6,36px)] items-center px-2 py-1 gap-x-1 border-b border-brand-border ${ROW_BG[p.status]}`}>
                    <div className="min-w-0 pr-1 space-y-0.5">
                      <p className="text-xs font-medium text-brand-dark truncate">{p.displayName}</p>
                      {p.selfReportBadge && (
                        <p className="text-[9px] text-brand-muted leading-none">{p.selfReportBadge}</p>
                      )}
                      {p.status === 'has_sub' && p.subbedByName && (
                        <p className="text-[9px] text-green-700 font-medium leading-none truncate">✓ {p.subbedByName}</p>
                      )}
                    </div>
                    {/* The whole 44px-tall cell is the tap target (not just the dot) so
                        marking attendance for a full roster on a phone isn't fiddly. */}
                    {ROSTER_STATUSES.map((s) => (
                      <label key={s.key} className="flex items-center justify-center min-h-[44px] cursor-pointer">
                        <input
                          type="radio"
                          name={`status-${p.id}`}
                          checked={p.status === s.key}
                          onChange={() => onSetStatus(p.id, s.key)}
                          disabled={disabled}
                          className="w-5 h-5 accent-brand-dark cursor-pointer disabled:opacity-50"
                        />
                      </label>
                    ))}
                  </div>
                  {p.status === 'has_sub' && onAssignSub && (
                    <div className={`px-3 py-1.5 bg-orange-50 flex items-center gap-2 ${!isLast ? 'border-b border-brand-border' : ''}`}>
                      {p.subbedByName ? (
                        <>
                          <span className="text-[11px] text-green-700 font-medium">✓ Subbed by {p.subbedByName}</span>
                          <button onClick={() => onAssignSub(p.id)} className="text-[11px] text-brand-muted underline">Change</button>
                        </>
                      ) : (
                        <button
                          onClick={() => onAssignSub(p.id)}
                          className="text-[11px] text-orange-700 font-semibold bg-orange-100 border border-orange-200 px-2 py-1 rounded-lg"
                        >
                          + Assign Sub
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Subs & Guests — spreadsheet table */}
      {subs.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide mb-1.5">Subs &amp; Guests</p>
          <div className="rounded-xl border border-brand-border overflow-hidden">
            {/* Header — click a column label to mark all subs with that status */}
            <div className="grid grid-cols-[1fr_repeat(5,36px)] items-end bg-brand-soft border-b border-brand-border px-2 py-1.5 gap-x-1">
              <div>
                <span className="text-[9px] font-bold text-brand-muted uppercase tracking-wide">Player</span>
                <p className="text-[8px] text-brand-muted/60 leading-none mt-0.5">tap col → all</p>
              </div>
              {SUB_STATUSES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => onSetAll(subs.map((p) => p.id), s.key)}
                  disabled={disabled || subs.length === 0}
                  title={`Mark all as ${s.label}${s.sublabel ? ' ' + s.sublabel : ''}`}
                  className="text-[9px] font-bold text-brand-muted text-center leading-tight underline decoration-dotted underline-offset-2 hover:text-brand-active disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {s.label}{s.sublabel && <><br />{s.sublabel}</>}
                </button>
              ))}
            </div>
            {subs.map((p, idx) => {
              const isLast = idx === subs.length - 1
              return (
                <div key={p.id} className={`grid grid-cols-[1fr_repeat(5,36px)] items-center px-2 py-1 gap-x-1 ${!isLast ? 'border-b border-brand-border' : ''} ${ROW_BG[p.status]}`}>
                  <div className="min-w-0 pr-1 space-y-0.5">
                    <div className="flex items-center gap-1 min-w-0">
                      <p className="text-xs font-medium text-brand-dark truncate">{p.displayName}</p>
                      <span className={`flex-shrink-0 text-[8px] font-bold px-1 py-0.5 rounded-full ${p.kind === 'sub' ? 'bg-yellow-100 text-yellow-700' : 'bg-purple-100 text-purple-700'}`}>
                        {p.kind === 'sub' ? 'Sub' : 'G'}
                      </span>
                    </div>
                    {p.coveringName && <p className="text-[9px] text-green-700 leading-none">for {p.coveringName}</p>}
                    {p.selfReportBadge && (
                      <p className="text-[9px] text-brand-muted leading-none">{p.selfReportBadge}</p>
                    )}
                  </div>
                  {/* Full-cell 44px tap target — see roster grid above. */}
                  {SUB_STATUSES.map((s) => (
                    <label key={s.key} className="flex items-center justify-center min-h-[44px] cursor-pointer">
                      <input
                        type="radio"
                        name={`status-${p.id}`}
                        checked={p.status === s.key}
                        onChange={() => onSetStatus(p.id, s.key)}
                        disabled={disabled}
                        className="w-5 h-5 accent-brand-dark cursor-pointer disabled:opacity-50"
                      />
                    </label>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
