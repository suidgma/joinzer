'use client'
import { useState } from 'react'
import { useRealtimeChannel } from '@/lib/realtime/hooks'

type Division = { id: string; name: string }
type Match = {
  id: string
  division_id: string
  match_number: number
  round_number: number | null
  court_number: number | null
  scheduled_time: string | null
  team_1_registration_id: string | null
  team_2_registration_id: string | null
  team_1_score: number | null
  team_2_score: number | null
  winner_registration_id: string | null
  status: string
  sequence_number?: number | null
  is_draft?: boolean
}
type Reg = {
  id: string
  user_id: string
  division_id: string
  team_name: string | null
  status: string
  partner_user_id: string | null
  partner_registration_id: string | null
  profiles: { name: string } | null
  partner_name: string | null
  // Pre-gated seed to display (null when the division hides seeds or none is set).
  display_seed?: number | null
}

type StandingRow = { regId: string; name: string; wins: number; losses: number; pf: number; pa: number }

function firstName(name: string | null | undefined): string {
  if (!name) return ''
  return name.trim().split(/\s+/)[0]
}

function teamLabel(regId: string, regs: Reg[]): string {
  const reg = regs.find(r => r.id === regId)
  if (!reg) return 'TBD'
  // Seed shown only when the division's "show seed numbers" is on (display_seed is
  // pre-gated server-side), prefixed once for both singles and doubles.
  const seed = reg.display_seed != null ? `#${reg.display_seed} ` : ''
  // Doubles: both partners' first names (sorted), matching the bracket. Prefer
  // these over the stored team_name, which an import may set to anything.
  const p1 = firstName(reg.profiles?.name)
  const p2 = firstName(reg.partner_name)
  if (p1 && p2) return `${seed}${[p1, p2].sort((a, b) => a.localeCompare(b)).join('/')}`
  return `${seed}${reg.team_name || p1 || p2 || 'Player'}`
}

function computeStandings(matches: Match[], regs: Reg[]): StandingRow[] {
  const active = regs.filter(r => r.status === 'registered')

  // Doubles teams have two cross-linked registrations (one per player), but the
  // bracket only references one of them per team. Without folding the pair into a
  // single row, every team shows twice (with partner names reversed) and the
  // phantom twin carries 0 stats. Build a canonical-ID map so both partners' reg
  // IDs resolve to one standings row.
  const canonicalId = new Map<string, string>()
  const rowRegs: Reg[] = []
  const seen = new Set<string>()
  for (const r of active) {
    if (seen.has(r.id)) continue
    rowRegs.push(r)
    seen.add(r.id)
    canonicalId.set(r.id, r.id)
    if (r.partner_registration_id) {
      seen.add(r.partner_registration_id)
      canonicalId.set(r.partner_registration_id, r.id)
    }
  }
  const canon = (id: string) => canonicalId.get(id) ?? id

  const map = new Map<string, StandingRow>()
  for (const r of rowRegs) {
    map.set(r.id, { regId: r.id, name: teamLabel(r.id, regs), wins: 0, losses: 0, pf: 0, pa: 0 })
  }
  for (const m of matches) {
    if (m.status !== 'completed' || !m.team_1_registration_id || !m.team_2_registration_id) continue
    const t1 = canon(m.team_1_registration_id), t2 = canon(m.team_2_registration_id)
    const s1 = m.team_1_score ?? 0, s2 = m.team_2_score ?? 0
    if (!map.has(t1)) map.set(t1, { regId: t1, name: teamLabel(t1, regs), wins: 0, losses: 0, pf: 0, pa: 0 })
    if (!map.has(t2)) map.set(t2, { regId: t2, name: teamLabel(t2, regs), wins: 0, losses: 0, pf: 0, pa: 0 })
    const r1 = map.get(t1)!, r2 = map.get(t2)!
    const winner = m.winner_registration_id ? canon(m.winner_registration_id) : null
    if (winner === t1) { r1.wins++; r2.losses++ }
    else if (winner === t2) { r2.wins++; r1.losses++ }
    r1.pf += s1; r1.pa += s2
    r2.pf += s2; r2.pa += s1
  }
  // Same rule as the shared computeStandings: win% → +/- → points-for → name.
  const winPct = (r: StandingRow) => {
    const games = r.wins + r.losses
    return games === 0 ? 0 : r.wins / games
  }
  return Array.from(map.values()).sort((a, b) => {
    const wp = winPct(b) - winPct(a)
    if (wp !== 0) return wp
    const dd = (b.pf - b.pa) - (a.pf - a.pa)
    if (dd !== 0) return dd
    if (b.pf !== a.pf) return b.pf - a.pf
    // Tied (e.g. everyone 0–0 pre-play): alphabetical by name, not insertion order.
    return a.name.localeCompare(b.name)
  })
}

type Props = {
  tournamentId: string
  status?: string
  schedulingMethod?: string
  initialDivisions: Division[]
  initialMatches: Match[]
  initialRegistrations: Reg[]
}

export default function LiveScoreboard({ tournamentId, status, schedulingMethod, initialDivisions, initialMatches, initialRegistrations }: Props) {
  const [matches, setMatches] = useState<Match[]>(initialMatches)
  const [updatedAt, setUpdatedAt] = useState(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))

  // Live via the shared realtime infra (postgres_changes on tournament_matches, which is
  // public-readable + now in the realtime publication — see migration 20260714000005).
  useRealtimeChannel(
    { topic: `live-board-${tournamentId}`, postgresChanges: [{ event: '*', table: 'tournament_matches', filter: `tournament_id=eq.${tournamentId}` }] },
    (evt) => {
      if (evt.kind !== 'postgres_changes') return
      const payload = evt.payload
      setUpdatedAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
      if (payload.eventType === 'DELETE') {
        const deletedId = (payload.old as { id: string }).id
        setMatches(prev => prev.filter(m => m.id !== deletedId))
      } else {
        const updated = payload.new as Match
        // Unpublished draft matches must never surface on the live board. A publish flips
        // is_draft → false and arrives as an UPDATE, which falls through and gets added.
        if (updated.is_draft) {
          setMatches(prev => prev.filter(m => m.id !== updated.id))
          return
        }
        setMatches(prev =>
          prev.some(m => m.id === updated.id)
            ? prev.map(m => m.id === updated.id ? updated : m)
            : [...prev, updated]
        )
      }
    },
  )

  // Exclude null-null phantom matches (structural BYE slots in double elimination)
  // from the progress counter — they can never be played or scored.
  const playable = matches.filter(m => m.team_1_registration_id != null || m.team_2_registration_id != null)
  const inProgress = playable.filter(m => m.status === 'in_progress')
  const completed = playable.filter(m => m.status === 'completed')
  const total = playable.length

  // Only show the pulsing "Live" indicator when the tournament is actually under
  // way — otherwise a draft or upcoming event misleadingly reads as live.
  const isLive = status === 'in_progress' || inProgress.length > 0
  const isFinal = status === 'completed' || (total > 0 && completed.length === total)

  // Rolling court board: per court, the match on now (or up next) + the one after,
  // ordered by Match #. Auto-advances as scores land (a completed match drops off,
  // the next becomes current). Only meaningful for rolling schedules.
  const isRolling = schedulingMethod === 'rolling'
  const courtBoard = (() => {
    if (!isRolling) return []
    const byCourt = new Map<number, Match[]>()
    for (const m of playable) {
      if (m.court_number == null) continue
      ;(byCourt.get(m.court_number) ?? byCourt.set(m.court_number, []).get(m.court_number)!).push(m)
    }
    return [...byCourt.keys()].sort((a, b) => a - b).map(court => {
      const remaining = byCourt.get(court)!
        .filter(m => m.status !== 'completed')
        .sort((a, b) => (a.sequence_number ?? Infinity) - (b.sequence_number ?? Infinity))
      return { court, current: remaining[0] ?? null, next: remaining[1] ?? null }
    })
  })()

  return (
    <div className="space-y-5">
      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-xs text-brand-muted mb-1.5">
          <span>{completed.length} of {total} matches complete</span>
          {isLive ? (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
              Live · {updatedAt}
            </span>
          ) : isFinal ? (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-muted inline-block" />
              Final
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-muted/50 inline-block" />
              Not started
            </span>
          )}
        </div>
        <div className="w-full h-2 bg-brand-border rounded-full overflow-hidden">
          <div
            className="h-full bg-brand rounded-full transition-all duration-500"
            style={{ width: total > 0 ? `${Math.round((completed.length / total) * 100)}%` : '0%' }}
          />
        </div>
      </div>

      {/* Rolling court board: what's on now + up next, per court */}
      {courtBoard.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">Courts</h2>
          <div className="space-y-2">
            {courtBoard.map(({ court, current, next }) => (
              <div key={court} className="bg-white rounded-xl border border-brand-border px-4 py-3 space-y-1.5">
                <p className="text-sm font-bold text-brand-dark">Court {court}</p>
                {current ? (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                    <span className="font-semibold text-brand-dark shrink-0">
                      {current.status === 'in_progress' ? 'In Progress' : 'Up now'}: Match {current.sequence_number}
                    </span>
                    <span className="text-brand-muted truncate">
                      {teamLabel(current.team_1_registration_id ?? '', initialRegistrations)} vs {teamLabel(current.team_2_registration_id ?? '', initialRegistrations)}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-brand-muted">Court complete ✓</p>
                )}
                {next && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                    <span className="font-semibold text-brand-dark shrink-0">Next: Match {next.sequence_number}</span>
                    <span className="text-brand-muted truncate">
                      {teamLabel(next.team_1_registration_id ?? '', initialRegistrations)} vs {teamLabel(next.team_2_registration_id ?? '', initialRegistrations)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* In-progress matches */}
      {inProgress.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">
            On Court Now ({inProgress.length})
          </h2>
          <div className="space-y-2">
            {inProgress.map(m => (
              <div key={m.id} className="bg-white rounded-xl border border-green-200 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0 text-sm font-semibold text-brand-dark truncate">
                    {teamLabel(m.team_1_registration_id ?? '', initialRegistrations)}
                  </div>
                  <div className="text-lg font-bold text-brand-dark tabular-nums">
                    {m.team_1_score ?? 0} – {m.team_2_score ?? 0}
                  </div>
                  <div className="flex-1 min-w-0 text-sm font-semibold text-brand-dark truncate text-right">
                    {teamLabel(m.team_2_registration_id ?? '', initialRegistrations)}
                  </div>
                </div>
                {(m.court_number != null || m.sequence_number != null) && (
                  <p className="text-[10px] text-brand-muted text-center mt-1">
                    {m.court_number != null && `Court ${m.court_number}`}
                    {m.court_number != null && m.sequence_number != null && ' · '}
                    {m.sequence_number != null && `Match ${m.sequence_number}`}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Standings per division */}
      {[...initialDivisions].sort((a, b) => a.name.localeCompare(b.name)).map(div => {
        const divRegs = initialRegistrations.filter(r => r.division_id === div.id)
        const divMatches = matches.filter(m => m.division_id === div.id)
        const rows = computeStandings(divMatches, divRegs)
        if (rows.length === 0) return null
        return (
          <section key={div.id} className="space-y-2">
            <h2 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">{div.name}</h2>
            <div className="bg-white rounded-xl border border-brand-border overflow-hidden">
              <div className="grid grid-cols-[1.5rem_1fr_2rem_2rem_2rem_2.5rem] gap-x-1 px-4 py-2 text-[10px] font-semibold text-brand-muted uppercase tracking-wide border-b border-brand-border">
                <span>#</span>
                <span>Team</span>
                <span className="text-center">W</span>
                <span className="text-center">L</span>
                <span className="text-center">PF</span>
                <span className="text-center">+/−</span>
              </div>
              {rows.map((row, i) => {
                const diff = row.pf - row.pa
                return (
                  <div
                    key={row.regId}
                    className={`grid grid-cols-[1.5rem_1fr_2rem_2rem_2rem_2.5rem] gap-x-1 px-4 py-2.5 text-xs border-b border-brand-border last:border-0 ${i === 0 ? 'bg-brand-soft' : ''}`}
                  >
                    <span className="text-brand-muted font-medium">{i + 1}</span>
                    <span className="font-semibold text-brand-dark truncate">{row.name}</span>
                    <span className="text-center font-bold text-brand-dark">{row.wins}</span>
                    <span className="text-center text-brand-dark">{row.losses}</span>
                    <span className="text-center text-brand-muted">{row.pf}</span>
                    <span className={`text-center font-bold tabular-nums ${diff >= 0 ? 'text-brand-active' : 'text-red-600'}`}>
                      {diff >= 0 ? '+' : ''}{diff}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      {total === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-brand-muted">No matches yet — check back soon.</p>
        </div>
      )}
    </div>
  )
}
