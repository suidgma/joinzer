import Sparkline from '@/components/ui/sparkline'

export type LadderStandingRow = {
  rank: number
  name: string
  delta: number | null // prior - rank (positive = climbed since last night)
  wins: number
  losses: number
  positions: (number | null)[] // rank after each session (null = sat out that night)
  spark: number[] // negated positions over sessions (so up = climbing)
}

// The ladder rankings table — a single view: current position (+ movement since
// the last night), each session's rank across the top (like the box "position by
// week" grid), last-night W-L, and one rank-trend sparkline. Merges what used to be
// two overlapping tables (ranking + a separate position-by-week grid).
export default function LadderStandings({ rows, periodNumbers }: { rows: LadderStandingRow[]; periodNumbers: number[] }) {
  if (rows.length === 0) {
    return (
      <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
        <p className="text-2xl">🪜</p>
        <p className="text-sm font-medium text-brand-dark">No ladder yet</p>
        <p className="text-xs text-brand-muted">Set the ladder order on the Roster screen, then run a session.</p>
      </div>
    )
  }
  const showTrend = periodNumbers.length >= 2
  const th = 'px-3 py-2 text-center text-xs font-semibold text-brand-muted uppercase tracking-wide border-b border-l border-brand-border whitespace-nowrap bg-brand-soft'

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="min-w-full text-sm border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky left-0 bg-brand-soft text-left px-3 py-2 text-xs font-semibold text-brand-muted uppercase tracking-wide border-b border-r border-brand-border whitespace-nowrap z-10">Player</th>
            {periodNumbers.map((n) => <th key={n} className={th}>Wk {n}</th>)}
            <th className={th}>Last</th>
            {showTrend && <th className={th}>Trend</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const rowBg = i % 2 === 0 ? 'bg-white' : 'bg-brand-surface'
            return (
              <tr key={r.name + r.rank}>
                <td className={`sticky left-0 px-3 py-2.5 border-r border-b border-brand-border whitespace-nowrap z-10 ${rowBg}`}>
                  <span className="inline-flex items-center gap-1">
                    <span className="text-sm font-semibold text-brand-dark w-5 text-right">{r.rank}</span>
                    {r.delta != null && r.delta !== 0 && (
                      r.delta > 0
                        ? <span className="text-[10px] text-green-600 font-bold">▲{r.delta}</span>
                        : <span className="text-[10px] text-red-500 font-bold">▼{-r.delta}</span>
                    )}
                    <span className="text-sm font-medium text-brand-dark ml-1">{r.name}</span>
                  </span>
                </td>
                {r.positions.map((p, j) => {
                  const prev = j > 0 ? r.positions[j - 1] : null
                  const up = p != null && prev != null && p < prev
                  const down = p != null && prev != null && p > prev
                  return (
                    <td key={j} className={`px-3 py-2.5 text-center border-b border-l border-brand-border ${rowBg}`}>
                      {p != null
                        ? <span className={`text-sm font-medium ${up ? 'text-green-600' : down ? 'text-red-500' : 'text-brand-dark'}`}>#{p}</span>
                        : <span className="text-xs text-brand-muted">—</span>}
                    </td>
                  )
                })}
                <td className={`px-3 py-2.5 text-center border-b border-l border-brand-border ${rowBg}`}>
                  <span className="text-xs text-brand-muted whitespace-nowrap">{r.wins + r.losses > 0 ? `${r.wins}–${r.losses}` : '—'}</span>
                </td>
                {showTrend && (
                  <td className={`px-3 py-2 text-center border-b border-l border-brand-border ${rowBg}`}>
                    {r.spark.length >= 2 ? <Sparkline values={r.spark} /> : <span className="text-xs text-brand-muted">—</span>}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
