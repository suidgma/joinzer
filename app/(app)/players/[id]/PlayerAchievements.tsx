import Link from 'next/link'
import type { PlayerPlacement } from '@/lib/profile/resume'

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }
const PLACE_LABEL: Record<number, string> = { 1: 'Champion', 2: 'Finalist', 3: 'Podium' }

function fmt(d: string | null): string {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

// Tournament titles & podiums (from the achievements table). Hidden when the player has none.
export default function PlayerAchievements({ placements }: { placements: PlayerPlacement[] }) {
  if (placements.length === 0) return null

  const counts = [1, 2, 3]
    .map((p) => ({ p, n: placements.filter((x) => x.place === p).length }))
    .filter((c) => c.n > 0)

  return (
    <section className="bg-brand-surface border border-brand-border rounded-2xl p-5 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-bold text-brand-dark">Titles &amp; podiums</h2>
        <span className="text-xs text-brand-muted">{counts.map((c) => `${MEDAL[c.p]} ${c.n}`).join('  ')}</span>
      </div>
      <div className="space-y-2">
        {placements.map((pl, i) => {
          const row = (
            <div className="flex items-center gap-3">
              <span className="text-xl shrink-0" aria-hidden>{MEDAL[pl.place] ?? '🎖️'}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-brand-dark truncate">
                  <span className="text-brand-active">{PLACE_LABEL[pl.place] ?? `${pl.place}th`}</span>
                  {pl.divisionName ? ` · ${pl.divisionName}` : ''}
                </p>
                <p className="text-xs text-brand-muted truncate">{[pl.tournamentName, fmt(pl.earnedOn)].filter(Boolean).join(' · ')}</p>
              </div>
              {pl.tournamentId && <span className="text-brand-muted text-sm shrink-0">→</span>}
            </div>
          )
          return pl.tournamentId ? (
            <Link key={i} href={`/tournaments/${pl.tournamentId}`} className="block rounded-xl border border-brand-border px-3 py-2 hover:border-brand-active transition-colors">
              {row}
            </Link>
          ) : (
            <div key={i} className="rounded-xl border border-brand-border px-3 py-2">{row}</div>
          )
        })}
      </div>
    </section>
  )
}
