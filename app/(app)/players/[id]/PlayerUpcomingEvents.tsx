import Link from 'next/link'
import type { ResumeUpcoming } from '@/lib/profile/resume'

function fmtDate(d: string | null): string {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Upcoming competitive events (leagues not yet ended + future tournaments) from the loader.
// Casual/open play is excluded upstream. Hidden when there's nothing upcoming.
export default function PlayerUpcomingEvents({ upcoming }: { upcoming: ResumeUpcoming[] }) {
  if (upcoming.length === 0) return null

  return (
    <section className="bg-brand-surface border border-brand-border rounded-2xl p-5 space-y-2">
      <h2 className="font-heading text-base font-bold text-brand-dark">Upcoming</h2>
      <div className="space-y-2">
        {upcoming.map((u) => (
          <Link
            key={`${u.kind}-${u.id}`}
            href={`/${u.kind === 'league' ? 'leagues' : 'tournaments'}/${u.id}`}
            className="flex items-center gap-3 rounded-xl border border-brand-border px-3 py-2 hover:border-brand-active transition-colors"
          >
            <span className="text-[10px] font-bold uppercase tracking-wide text-brand-muted bg-brand-soft rounded px-1.5 py-0.5 shrink-0">
              {u.kind === 'league' ? 'League' : 'Tourney'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-brand-dark truncate">{u.name}</p>
              {(u.date || u.location) && (
                <p className="text-xs text-brand-muted truncate">{[fmtDate(u.date), u.location].filter(Boolean).join(' · ')}</p>
              )}
            </div>
            <span className="text-brand-muted text-sm shrink-0">→</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
