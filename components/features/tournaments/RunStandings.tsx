'use client'

// Read-only standings table for run mode. Rows are pre-computed (computeStandings) by RunMode,
// so this is pure presentation — kept out of RunMode to hold that file under the ~200-line line.

export type StandingRow = { regId: string; wins: number; losses: number; pf: number; pa: number }

export default function RunStandings({
  rows,
  teamName,
}: {
  rows: StandingRow[]
  teamName: (regId: string) => string
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-brand-muted px-1">No completed matches yet.</p>
  }
  return (
    <div className="overflow-hidden rounded-xl border border-brand-border">
      <div className="grid grid-cols-[1.5rem_1fr_2rem_2rem_2rem_2.5rem] gap-x-1 px-3 py-2 text-[10px] font-semibold text-brand-muted uppercase tracking-wide border-b border-brand-border">
        <span>#</span><span>Team</span><span className="text-center">W</span><span className="text-center">L</span><span className="text-center">PF</span><span className="text-center">+/−</span>
      </div>
      {rows.map((row, i) => {
        const diff = row.pf - row.pa
        return (
          <div key={row.regId} className={`grid grid-cols-[1.5rem_1fr_2rem_2rem_2rem_2.5rem] gap-x-1 px-3 py-2 text-xs border-b border-brand-border last:border-0 ${i === 0 ? 'bg-brand-soft' : ''}`}>
            <span className="text-brand-muted font-medium">{i + 1}</span>
            <span className="font-semibold text-brand-dark truncate">{teamName(row.regId)}</span>
            <span className="text-center font-bold text-brand-dark">{row.wins}</span>
            <span className="text-center text-brand-dark">{row.losses}</span>
            <span className="text-center text-brand-muted">{row.pf}</span>
            <span className={`text-center font-bold tabular-nums ${diff >= 0 ? 'text-brand-active' : 'text-red-600'}`}>{diff >= 0 ? '+' : ''}{diff}</span>
          </div>
        )
      })}
    </div>
  )
}
