type Row = { rank: number; name: string; movement?: 'up' | 'down' | null; wins: number; losses: number; winPct: number; pf: number; pa: number; diff: number }
type MatchResult = { id: string; name1: string; name2: string; score1: number; score2: number; winner1: boolean }
export type BoxStandingView = { name: string; rows: Row[]; matches?: MatchResult[] }

// Per-box standings tables (win% → point differential → points-for) plus, for a
// completed cycle, the match results and who promoted (▲) / relegated (▼).
export default function BoxStandings({ boxes }: { boxes: BoxStandingView[] }) {
  return (
    <div className="space-y-4">
      {boxes.map((b, i) => (
        <div key={i} className="bg-white rounded-xl border border-brand-border overflow-hidden">
          <div className="px-3 py-2 bg-brand-soft/40 border-b border-brand-border text-xs font-bold text-brand-dark uppercase tracking-wide">
            {b.name}
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-brand-muted border-b border-brand-border/60">
                <th className="text-left pl-3 pr-1 py-1.5 font-medium w-6">#</th>
                <th className="text-left px-1 py-1.5 font-medium">Player</th>
                <th className="text-right px-2 py-1.5 font-medium w-14">W–L</th>
                <th className="text-right px-2 py-1.5 font-medium w-14">Win%</th>
                <th className="text-right px-2 py-1.5 font-medium w-10">PF</th>
                <th className="text-right pl-2 pr-3 py-1.5 font-medium w-12">+/-</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map(r => (
                <tr key={r.rank} className="border-t border-brand-border/40">
                  <td className="pl-3 pr-1 py-1.5 text-brand-muted tabular-nums">{r.rank}</td>
                  <td className="px-1 py-1.5 font-medium text-brand-dark truncate">
                    {r.name}
                    {r.movement === 'up' && <span className="ml-1 text-green-600 font-bold" title="Promoted">▲</span>}
                    {r.movement === 'down' && <span className="ml-1 text-red-500 font-bold" title="Relegated">▼</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.wins}–{r.losses}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-brand-muted">{Math.round(r.winPct * 100)}%</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-brand-muted">{r.pf}</td>
                  <td className="pl-2 pr-3 py-1.5 text-right tabular-nums text-brand-muted">{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                </tr>
              ))}
              {b.rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-2 text-brand-muted">No players.</td></tr>
              )}
            </tbody>
          </table>

          {b.matches && b.matches.length > 0 && (
            <div className="border-t border-brand-border/60 bg-brand-soft/20">
              <p className="px-3 pt-2 text-[10px] font-bold text-brand-muted uppercase tracking-wider">Results</p>
              <ul className="px-3 pb-2 pt-1 space-y-0.5">
                {b.matches.map(m => {
                  const winner = m.winner1 ? m.name1 : m.name2
                  const loser = m.winner1 ? m.name2 : m.name1
                  const ws = Math.max(m.score1, m.score2)
                  const ls = Math.min(m.score1, m.score2)
                  return (
                    <li key={m.id} className="text-xs text-brand-muted truncate">
                      <span className="font-semibold text-brand-dark">{winner}</span> def. {loser}
                      <span className="ml-1.5 tabular-nums text-brand-dark">{ws}–{ls}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
