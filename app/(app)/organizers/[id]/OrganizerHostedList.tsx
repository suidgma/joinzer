import Link from 'next/link'
import type { HostedComp } from '@/lib/profile/organizer'

function fmtDate(d: string | null): string {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function humanStatus(s: string | null): string {
  if (!s) return ''
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

const FORMAT_LABEL: Record<string, string> = {
  session_rr: 'Round Robin', round_robin: 'Round Robin', box: 'Box', ladder: 'Ladder', team: 'Team', flex: 'Flex',
}

// A titled list of the comps an organizer hosts (tournaments or leagues). Rows link to
// the comp; active/upcoming ones get a filled dot, past ones a muted dot. Hidden when empty.
export default function OrganizerHostedList({ title, comps }: { title: string; comps: HostedComp[] }) {
  if (comps.length === 0) return null

  return (
    <section className="bg-brand-surface border border-brand-border rounded-2xl p-5 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-bold text-brand-dark">{title}</h2>
        <span className="text-xs text-brand-muted">{comps.length}</span>
      </div>
      <div className="space-y-2">
        {comps.map((c) => {
          const href = c.kind === 'tournament' ? `/tournaments/${c.id}` : `/leagues/${c.id}`
          const meta = [
            c.formatKind ? (FORMAT_LABEL[c.formatKind] ?? humanStatus(c.formatKind)) : null,
            c.location,
            fmtDate(c.date),
          ].filter(Boolean).join(' · ')
          return (
            <Link
              key={`${c.kind}-${c.id}`}
              href={href}
              className="flex items-center gap-3 rounded-xl border border-brand-border px-3 py-2 hover:border-brand-active transition-colors"
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${c.isPast ? 'bg-brand-border' : 'bg-brand-active'}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-brand-dark truncate">{c.name}</p>
                {meta && <p className="text-xs text-brand-muted truncate">{meta}</p>}
              </div>
              {c.status && (
                <span className="text-[10px] font-medium text-brand-muted uppercase tracking-wide shrink-0">{humanStatus(c.status)}</span>
              )}
            </Link>
          )
        })}
      </div>
    </section>
  )
}
