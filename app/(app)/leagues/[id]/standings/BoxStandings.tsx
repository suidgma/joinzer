type Row = { rank: number; name: string; movement?: 'up' | 'down' | null; wins: number; losses: number; winPct: number; pf: number; pa: number; diff: number }
type MatchResult = { id: string; round: number | null; name1: string; name2: string; score1: number; score2: number; winner1: boolean }
export type BoxStandingView = { name: string; rows: Row[]; matches?: MatchResult[] }

// Group results by round (Round 1, Round 2, …); unrounded fixtures sort last.
function groupByRound(matches: MatchResult[]): [number | null, MatchResult[]][] {
  const map = new Map<number | null, MatchResult[]>()
  for (const m of matches) {
    const k = m.round ?? null
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(m)
  }
  return [...map.entries()].sort((a, b) => (a[0] ?? Infinity) - (b[0] ?? Infinity))
}

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
              <div className="px-3 pb-2 pt-1 space-y-1.5">
                {groupByRound(b.matches).map(([round, ms]) => (
                  <div key={round ?? 'none'} className="space-y-0.5">
                    {round != null && <p className="text-[10px] font-semibold text-brand-dark">Round {round}</p>}
                    <ul className="space-y-0.5">
                      {ms.map(m => {
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
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
