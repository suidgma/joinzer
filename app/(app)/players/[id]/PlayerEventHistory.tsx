import Link from 'next/link'
import type { ResumeUpcoming } from '@/lib/profile/resume'

function fmtDate(d: string | null): string {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

// Completed competitions the player took part in (leagues ended / past tournaments), most
// recent first. Placements/titles are Phase 3. Hidden when there's no history.
export default function PlayerEventHistory({ history }: { history: ResumeUpcoming[] }) {
  if (history.length === 0) return null

  return (
    <section className="bg-brand-surface border border-brand-border rounded-2xl p-5 space-y-2">
      <h2 className="font-heading text-base font-bold text-brand-dark">Event history</h2>
      <div className="space-y-2">
        {history.map((e) => (
          <Link
            key={`${e.kind}-${e.id}`}
            href={`/${e.kind === 'league' ? 'leagues' : 'tournaments'}/${e.id}`}
            className="flex items-center gap-3 rounded-xl border border-brand-border px-3 py-2 hover:border-brand-active transition-colors"
          >
            <span className="text-[10px] font-bold uppercase tracking-wide text-brand-muted bg-brand-soft rounded px-1.5 py-0.5 shrink-0">
              {e.kind === 'league' ? 'League' : 'Tourney'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-brand-dark truncate">{e.name}</p>
              {(e.date || e.location) && (
                <p className="text-xs text-brand-muted truncate">{[fmtDate(e.date), e.location].filter(Boolean).join(' · ')}</p>
              )}
            </div>
            <span className="text-brand-muted text-sm shrink-0">→</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
