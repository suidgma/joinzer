'use client'
import type { OrgMatch, OrgRegistration, OrgDivision } from './types'
import { teamLabel } from './ScoreEntryModal'
import { computeStandings as computeRows } from '@/lib/tournament/standings'

type Row = { regId: string; name: string; wins: number; losses: number; pf: number; pa: number }

// Shared computeStandings handles canonical folding + elimination ordering;
// here we just attach each team's display label.
function computeStandings(matches: OrgMatch[], regs: OrgRegistration[]): Row[] {
  return computeRows(matches, regs, (regId) => teamLabel(regId, regs)).map(r => ({ ...r, name: teamLabel(r.regId, regs) }))
}

type Props = {
  matches: OrgMatch[]
  registrations: OrgRegistration[]
  divisions: OrgDivision[]
  updatedAt: string
  status?: string
}

export default function StandingsTab({ matches, registrations, divisions, updatedAt, status }: Props) {
  // Only badge as "Live" when play is actually under way.
  const isLive = status === 'in_progress' || matches.some(m => m.status === 'in_progress')
  const completedCount = matches.filter(m => m.status === 'completed').length
  const isFinal = status === 'completed' || (matches.length > 0 && completedCount === matches.length)

  // Standings rows per division (a division with registered teams shows even
  // before any matches are played — teams start at 0–0).
  const withRows = [...divisions]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(div => ({
      div,
      rows: computeStandings(
        matches.filter(m => m.division_id === div.id),
        registrations.filter(r => r.division_id === div.id),
      ),
    }))
    .filter(d => d.rows.length > 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">Standings/Results</h3>
        {isLive ? (
          <span className="text-[10px] text-brand-muted flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
            Live · {updatedAt}
          </span>
        ) : isFinal ? (
          <span className="text-[10px] text-brand-muted flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-muted inline-block" />
            Final
          </span>
        ) : null}
      </div>

      {divisions.length > 0 && withRows.length === 0 && (
        <div className="bg-white rounded-xl border border-brand-border text-center py-12 px-4">
          <p className="text-2xl mb-2">📊</p>
          <p className="text-sm font-semibold text-brand-dark">No standings yet</p>
          <p className="text-xs text-brand-muted mt-1">
            Standings appear once players register and matches are played.
          </p>
        </div>
      )}

      {withRows.map(({ div, rows }) => {
        return (
          <div key={div.id} className="bg-white rounded-xl border border-brand-border overflow-hidden">
            <div className="px-4 py-2.5 border-b border-brand-border">
              <span className="text-xs font-bold text-brand-dark">{div.name}</span>
            </div>
            <div>
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
          </div>
        )
      })}

      {divisions.length === 0 && (
        <p className="text-sm text-brand-muted text-center py-10">No divisions found.</p>
      )}
    </div>
  )
}
