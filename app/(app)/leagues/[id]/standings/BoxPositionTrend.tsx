import Sparkline from '@/components/ui/sparkline'
import type { BoxTrendRow } from '@/lib/leagues/boxTrend'

// Cross-cycle position grid for box leagues — each player's overall rank per cycle
// across the top (like round-robin's per-week columns), with movement color and a
// trend sparkline. Lower position = better; green = moved up vs the prior cycle.
export default function BoxPositionTrend({ rows, cycleNumbers }: { rows: BoxTrendRow[]; cycleNumbers: number[] }) {
  if (rows.length === 0 || cycleNumbers.length === 0) return null
  const showTrend = cycleNumbers.length >= 2

  return (
    <div className="space-y-2">
      <div>
        <h2 className="font-heading text-base font-bold text-brand-dark">Position by cycle</h2>
        <p className="text-xs text-brand-muted">Overall ladder position each cycle — lower is better.</p>
      </div>
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="min-w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 bg-brand-soft text-left px-3 py-2 text-xs font-semibold text-brand-muted uppercase tracking-wide border-b border-r border-brand-border whitespace-nowrap z-10">Player</th>
              {cycleNumbers.map((n) => (
                <th key={n} className="px-3 py-2 text-center text-xs font-semibold text-brand-muted uppercase tracking-wide border-b border-l border-brand-border whitespace-nowrap bg-brand-soft">Cycle {n}</th>
              ))}
              {showTrend && <th className="px-3 py-2 text-center text-xs font-semibold text-brand-muted uppercase tracking-wide border-b border-l border-brand-border whitespace-nowrap bg-brand-soft">Trend</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const rowBg = i % 2 === 0 ? 'bg-white' : 'bg-brand-surface'
              const spark = r.positions.filter((p): p is number => p != null).map((p) => -p) // negate so climbing plots up
              return (
                <tr key={r.regId}>
                  <td className={`sticky left-0 px-3 py-2.5 border-r border-b border-brand-border whitespace-nowrap z-10 ${rowBg}`}>
                    <span className="text-brand-muted text-xs mr-2">#{r.current}</span>
                    <span className="text-sm font-medium text-brand-dark">{r.name}</span>
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
                  {showTrend && (
                    <td className={`px-3 py-2 text-center border-b border-l border-brand-border ${rowBg}`}>
                      {spark.length >= 2 ? <Sparkline values={spark} /> : <span className="text-xs text-brand-muted">—</span>}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
