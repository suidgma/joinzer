import type { OrgMatch, OrgRegistration, OrgDivision } from './types'
import { teamLabel } from './ScoreEntryModal'

type Row = { regId: string; name: string; wins: number; losses: number; pf: number; pa: number }

function computeStandings(matches: OrgMatch[], regs: OrgRegistration[]): Row[] {
  const map = new Map<string, Row>()
  for (const r of regs.filter(r => r.status === 'registered')) {
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
  matches: OrgMatch[]
  registrations: OrgRegistration[]
  divisions: OrgDivision[]
  updatedAt: string
}

export default function StandingsTab({ matches, registrations, divisions, updatedAt }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">Standings</h3>
        <span className="text-[10px] text-brand-muted flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
          Live · {updatedAt}
        </span>
      </div>

      {divisions.map(div => {
        const divRegs = registrations.filter(r => r.division_id === div.id)
        const divMatches = matches.filter(m => m.division_id === div.id)
        const rows = computeStandings(divMatches, divRegs)
        if (rows.length === 0) return null
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
