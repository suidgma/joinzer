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
        <div key={i} className="bg-white rounded-2xl border border-brand-border overflow-hidden shadow-sm">
          {/* Box header */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-brand-soft/50 border-b border-brand-border">
            <h3 className="text-sm font-bold text-brand-dark tracking-wide">{b.name}</h3>
            {b.rows.length > 0 && (
              <span className="text-[11px] text-brand-muted tabular-nums">{b.rows.length} player{b.rows.length === 1 ? '' : 's'}</span>
            )}
          </div>

          <table className="w-full text-xs">
            <thead>
              <tr className="text-brand-muted/80 border-b border-brand-border/60 text-[10px] uppercase tracking-wide">
                <th className="text-left pl-3 pr-1 py-2 font-semibold w-8">#</th>
                <th className="text-left px-1 py-2 font-semibold">Player</th>
                <th className="text-center px-2 py-2 font-semibold w-14">W–L</th>
                <th className="text-right px-2 py-2 font-semibold w-16">Win%</th>
                <th className="text-right px-2 py-2 font-semibold w-10">PF</th>
                <th className="text-right pl-2 pr-3 py-2 font-semibold w-12">+/-</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map(r => {
                const leader = r.rank === 1
                const pct = Math.round(r.winPct * 100)
                return (
                  <tr key={r.rank} className={`border-t border-brand-border/40 ${leader ? 'bg-brand/5' : ''}`}>
                    <td className="pl-3 pr-1 py-2">
                      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold tabular-nums ${leader ? 'bg-brand text-brand-dark' : 'text-brand-muted'}`}>
                        {r.rank}
                      </span>
                    </td>
                    <td className="px-1 py-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate font-medium text-brand-dark">{r.name}</span>
                        {r.movement === 'up' && <span className="shrink-0 text-[9px] font-bold text-green-700 bg-green-100 rounded px-1 leading-4" title="Promoted">▲</span>}
                        {r.movement === 'down' && <span className="shrink-0 text-[9px] font-bold text-red-600 bg-red-100 rounded px-1 leading-4" title="Relegated">▼</span>}
                      </div>
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
                    <td className="px-2 py-2 text-right tabular-nums text-brand-muted">{r.pf}</td>
                    <td className={`pl-2 pr-3 py-2 text-right tabular-nums font-medium ${r.diff > 0 ? 'text-green-700' : r.diff < 0 ? 'text-red-600' : 'text-brand-muted'}`}>
                      {r.diff > 0 ? `+${r.diff}` : r.diff}
                    </td>
                  </tr>
                )
              })}
              {b.rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-3 text-brand-muted text-center">No players.</td></tr>
              )}
            </tbody>
          </table>

          {b.matches && b.matches.length > 0 && (
            <div className="border-t border-brand-border/60 bg-brand-soft/20">
              <p className="px-4 pt-2.5 text-[10px] font-bold text-brand-muted uppercase tracking-wider">Results</p>
              <div className="px-4 pb-3 pt-1.5 space-y-2">
                {groupByRound(b.matches).map(([round, ms]) => (
                  <div key={round ?? 'none'} className="space-y-1">
                    {round != null && <p className="text-[10px] font-semibold text-brand-dark uppercase tracking-wide">Round {round}</p>}
                    <ul className="space-y-1">
                      {ms.map(m => {
                        const winner = m.winner1 ? m.name1 : m.name2
                        const loser = m.winner1 ? m.name2 : m.name1
                        const ws = Math.max(m.score1, m.score2)
                        const ls = Math.min(m.score1, m.score2)
                        return (
                          <li key={m.id} className="flex items-center gap-2 text-xs">
                            <span className="flex-1 min-w-0 truncate text-brand-muted">
                              <span className="font-semibold text-brand-dark">{winner}</span> def. {loser}
                            </span>
                            <span className="shrink-0 tabular-nums font-semibold text-brand-dark">{ws}–{ls}</span>
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
