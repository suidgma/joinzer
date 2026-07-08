import type { PlayerStats } from '@/lib/rating/stats'

function Tile({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="bg-brand-soft/50 rounded-xl px-3 py-2.5 text-center">
      <p className={`text-xl font-extrabold tabular-nums ${accent ?? 'text-brand-dark'}`}>{value}</p>
      <p className="text-[11px] text-brand-muted mt-0.5">{label}</p>
    </div>
  )
}

// Competitive career snapshot: matches / W / L / win% / streak / events, plus a
// leagues·tournaments·format-split line. Hidden entirely when there are no matches.
export default function PlayerCareerStats({ stats }: { stats: PlayerStats }) {
  if (stats.matches === 0) return null

  const pct = Math.round(stats.winPct * 100)
  const streak = stats.currentStreak
  const streakValue = streak ? `${streak.type}${streak.count}` : '—'
  const streakAccent = streak?.type === 'W' ? 'text-green-700' : streak?.type === 'L' ? 'text-red-600' : undefined
  const bothFormats = stats.byFormat.doubles.matches > 0 && stats.byFormat.singles.matches > 0

  return (
    <section className="bg-brand-surface border border-brand-border rounded-2xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-bold text-brand-dark">Career</h2>
        <span className="text-[11px] text-brand-muted">Competitive only</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Tile label="Matches" value={stats.matches} />
        <Tile label="Wins" value={stats.wins} accent="text-green-700" />
        <Tile label="Losses" value={stats.losses} accent="text-red-600" />
        <Tile label="Win %" value={`${pct}%`} />
        <Tile label="Streak" value={streakValue} accent={streakAccent} />
        <Tile label="Events" value={stats.eventsPlayed} />
      </div>

      <p className="text-xs text-brand-muted">
        {stats.leaguesPlayed} league{stats.leaguesPlayed === 1 ? '' : 's'} · {stats.tournamentsPlayed} tournament{stats.tournamentsPlayed === 1 ? '' : 's'}
        {bothFormats && <> · {stats.byFormat.doubles.matches} doubles / {stats.byFormat.singles.matches} singles</>}
      </p>
    </section>
  )
}
