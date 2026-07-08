type TeamStandingRow = {
  rank: number
  name: string
  wins: number
  losses: number
  winPct: number
  linesFor: number
  linesAgainst: number
  diff: number
}

// Team-league table: matchup W–L → line-win differential (via the shared rankEntities
// core). W–L counts team matchups won; Lines is total line wins; +/- is line differential.
export default function TeamStandings({ rows }: { rows: TeamStandingRow[] }) {
  return (
    <div className="bg-white rounded-2xl border border-brand-border overflow-hidden shadow-sm">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-brand-muted/80 border-b border-brand-border/60 text-[10px] uppercase tracking-wide">
            <th className="text-left pl-3 pr-1 py-2 font-semibold w-8">#</th>
            <th className="text-left px-1 py-2 font-semibold">Team</th>
            <th className="text-center px-2 py-2 font-semibold w-14">W–L</th>
            <th className="text-right px-2 py-2 font-semibold w-16">Win%</th>
            <th className="text-right px-2 py-2 font-semibold w-12">Lines</th>
            <th className="text-right pl-2 pr-3 py-2 font-semibold w-12">+/-</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const leader = r.rank === 1 && r.wins + r.losses > 0
            const pct = Math.round(r.winPct * 100)
            return (
              <tr key={r.rank} className={`border-t border-brand-border/40 ${leader ? 'bg-brand/5' : ''}`}>
                <td className="pl-3 pr-1 py-2">
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold tabular-nums ${leader ? 'bg-brand text-brand-dark' : 'text-brand-muted'}`}>
                    {r.rank}
                  </span>
                </td>
                <td className="px-1 py-2">
                  <span className="truncate font-medium text-brand-dark">{r.name}</span>
                </td>
                <td className="px-2 py-2 text-center tabular-nums">
                  <span className="font-semibold text-brand-dark">{r.wins}</span><span className="text-brand-muted">–{r.losses}</span>
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-col items-end gap-1">
                    <span className="tabular-nums font-medium text-brand-dark">{pct}%</span>
                    <div className="w-full max-w-[3rem] h-1 rounded-full bg-brand-soft overflow-hidden">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-brand-muted">{r.linesFor}</td>
                <td className={`pl-2 pr-3 py-2 text-right tabular-nums font-medium ${r.diff > 0 ? 'text-green-700' : r.diff < 0 ? 'text-red-600' : 'text-brand-muted'}`}>
                  {r.diff > 0 ? `+${r.diff}` : r.diff}
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-3 text-brand-muted text-center">No teams yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
