import type { PlayerStats } from '@/lib/rating/stats'

// Last-10 competitive results as a W/L pill strip (chronological, oldest → most recent)
// plus the window record. Hidden when there are no matches.
export default function PlayerRecentForm({ stats }: { stats: PlayerStats }) {
  if (stats.recentForm.length === 0) return null

  return (
    <section className="bg-brand-surface border border-brand-border rounded-2xl p-5 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-bold text-brand-dark">Recent form</h2>
        <span className="text-xs text-brand-muted">
          Last {stats.recentForm.length}: {stats.recentRecord.wins}–{stats.recentRecord.losses}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {stats.recentForm.map((r, i) => (
          <span
            key={i}
            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              r === 'W' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
            }`}
          >
            {r}
          </span>
        ))}
      </div>
      <p className="text-[11px] text-brand-muted">Oldest → most recent</p>
    </section>
  )
}
