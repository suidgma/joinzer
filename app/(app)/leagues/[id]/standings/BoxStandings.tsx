type Row = { rank: number; name: string; wins: number; losses: number; winPct: number; pf: number; pa: number; diff: number }
export type BoxStandingView = { name: string; rows: Row[] }

// Per-box standings tables (win% → point differential → points-for), computed
// from box fixtures via the shared computeFixtureStandings. Read-only.
export default function BoxStandings({ boxes }: { boxes: BoxStandingView[] }) {
  return (
    <div className="space-y-5">
      {boxes.map((b, i) => (
        <div key={i} className="bg-white rounded-xl border border-brand-border overflow-hidden">
          <div className="px-3 py-2 bg-brand-soft/40 border-b border-brand-border text-xs font-bold text-brand-dark uppercase tracking-wide">
            {b.name}
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-brand-muted">
                <th className="text-left px-3 py-1.5 font-medium w-6">#</th>
                <th className="text-left px-1 py-1.5 font-medium">Player</th>
                <th className="text-center px-2 py-1.5 font-medium">W–L</th>
                <th className="text-center px-2 py-1.5 font-medium">Win%</th>
                <th className="text-center px-2 py-1.5 font-medium">PF</th>
                <th className="text-center px-2 py-1.5 font-medium">+/-</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map(r => (
                <tr key={r.rank} className="border-t border-brand-border/40">
                  <td className="px-3 py-1.5 text-brand-muted tabular-nums">{r.rank}</td>
                  <td className="px-1 py-1.5 font-medium text-brand-dark truncate">{r.name}</td>
                  <td className="px-2 py-1.5 text-center tabular-nums">{r.wins}–{r.losses}</td>
                  <td className="px-2 py-1.5 text-center tabular-nums">{Math.round(r.winPct * 100)}%</td>
                  <td className="px-2 py-1.5 text-center tabular-nums">{r.pf}</td>
                  <td className="px-2 py-1.5 text-center tabular-nums">{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                </tr>
              ))}
              {b.rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-2 text-brand-muted">No players.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
