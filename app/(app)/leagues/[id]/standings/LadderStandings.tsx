import Sparkline from '@/components/ui/sparkline'

export type LadderStandingRow = {
  rank: number
  name: string
  prior: number | null
  delta: number | null // prior - rank (positive = climbed)
  wins: number
  losses: number
  spark: number[] // negated positions over sessions (so up = climbing)
}

// The ladder rankings table: current position, movement since the last session,
// last-night W-L, and a rank trend sparkline.
export default function LadderStandings({ rows, hasHistory }: { rows: LadderStandingRow[]; hasHistory: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
        <p className="text-2xl">🪜</p>
        <p className="text-sm font-medium text-brand-dark">No ladder yet</p>
        <p className="text-xs text-brand-muted">Set the ladder order on the Roster screen, then run a session.</p>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-brand-border overflow-hidden">
      <div className="grid grid-cols-[2.5rem_1fr_auto_auto] items-center gap-2 px-3 py-1.5 bg-brand-soft border-b border-brand-border text-[10px] font-bold text-brand-muted uppercase tracking-wide">
        <span>#</span>
        <span>Player</span>
        <span className="text-right">Last</span>
        {hasHistory && <span className="text-right pr-1">Trend</span>}
      </div>
      <div className="divide-y divide-brand-border">
        {rows.map((r) => (
          <div key={r.name + r.rank} className="grid grid-cols-[2.5rem_1fr_auto_auto] items-center gap-2 px-3 py-1.5">
            <span className="flex items-center gap-1 text-sm font-semibold text-brand-dark">
              {r.rank}
              {r.delta != null && r.delta !== 0 && (
                r.delta > 0
                  ? <span className="text-[10px] text-green-600 font-bold">▲{r.delta}</span>
                  : <span className="text-[10px] text-red-500 font-bold">▼{-r.delta}</span>
              )}
            </span>
            <span className="text-sm text-brand-dark truncate">{r.name}</span>
            <span className="text-xs text-brand-muted text-right whitespace-nowrap">
              {r.wins + r.losses > 0 ? `${r.wins}–${r.losses}` : '—'}
            </span>
            {hasHistory && (
              <span className="justify-self-end">{r.spark.length >= 2 ? <Sparkline values={r.spark} /> : <span className="text-xs text-brand-muted">—</span>}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
