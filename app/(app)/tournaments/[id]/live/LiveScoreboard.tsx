'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

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
}
type Reg = {
  id: string
  user_id: string
  division_id: string
  team_name: string | null
  status: string
  partner_user_id: string | null
  profiles: { name: string } | null
}

type StandingRow = { regId: string; name: string; wins: number; losses: number; pf: number; pa: number }

function teamLabel(regId: string, regs: Reg[]): string {
  const reg = regs.find(r => r.id === regId)
  if (!reg) return 'TBD'
  return reg.team_name ?? reg.profiles?.name ?? 'Player'
}

function computeStandings(matches: Match[], regs: Reg[]): StandingRow[] {
  const map = new Map<string, StandingRow>()
  for (const r of regs) {
    map.set(r.id, { regId: r.id, name: teamLabel(r.id, regs), wins: 0, losses: 0, pf: 0, pa: 0 })
  }
  for (const m of matches) {
    if (m.status !== 'completed' || !m.team_1_registration_id || !m.team_2_registration_id) continue
    const t1 = m.team_1_registration_id, t2 = m.team_2_registration_id
    const s1 = m.team_1_score ?? 0, s2 = m.team_2_score ?? 0
    if (!map.has(t1)) map.set(t1, { regId: t1, name: teamLabel(t1, regs), wins: 0, losses: 0, pf: 0, pa: 0 })
    if (!map.has(t2)) map.set(t2, { regId: t2, name: teamLabel(t2, regs), wins: 0, losses: 0, pf: 0, pa: 0 })
    const r1 = map.get(t1)!, r2 = map.get(t2)!
    if (m.winner_registration_id === t1) { r1.wins++; r2.losses++ }
    else if (m.winner_registration_id === t2) { r2.wins++; r1.losses++ }
    r1.pf += s1; r1.pa += s2
    r2.pf += s2; r2.pa += s1
  }
  return Array.from(map.values()).sort((a, b) => {
    const wd = b.wins - a.wins
    if (wd !== 0) return wd
    return (b.pf - b.pa) - (a.pf - a.pa)
  })
}

type Props = {
  tournamentId: string
  initialDivisions: Division[]
  initialMatches: Match[]
  initialRegistrations: Reg[]
}

export default function LiveScoreboard({ tournamentId, initialDivisions, initialMatches, initialRegistrations }: Props) {
  const [matches, setMatches] = useState<Match[]>(initialMatches)
  const [updatedAt, setUpdatedAt] = useState(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`live-board-${tournamentId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'tournament_matches',
        filter: `tournament_id=eq.${tournamentId}`,
      }, payload => {
        setUpdatedAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
        if (payload.eventType === 'DELETE') {
          const deletedId = (payload.old as { id: string }).id
          setMatches(prev => prev.filter(m => m.id !== deletedId))
        } else {
          const updated = payload.new as Match
          setMatches(prev =>
            prev.some(m => m.id === updated.id)
              ? prev.map(m => m.id === updated.id ? updated : m)
              : [...prev, updated]
          )
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [tournamentId])

  const inProgress = matches.filter(m => m.status === 'in_progress')
  const completed = matches.filter(m => m.status === 'completed')
  const total = matches.length

  return (
    <div className="space-y-5">
      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-xs text-brand-muted mb-1.5">
          <span>{completed.length} of {total} matches complete</span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
            Live · {updatedAt}
          </span>
        </div>
        <div className="w-full h-2 bg-brand-border rounded-full overflow-hidden">
          <div
            className="h-full bg-brand rounded-full transition-all duration-500"
            style={{ width: total > 0 ? `${Math.round((completed.length / total) * 100)}%` : '0%' }}
          />
        </div>
      </div>

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
                {m.court_number != null && (
                  <p className="text-[10px] text-brand-muted text-center mt-1">Court {m.court_number}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Standings per division */}
      {initialDivisions.map(div => {
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
