import Link from 'next/link'
import { formatEventTime } from '@/lib/utils/date'
import type { EventListItem } from '@/lib/types'

export default function EventCard({ event }: { event: EventListItem }) {
  const joinedCount = event.event_participants.filter(
    (p) => p.participant_status === 'joined'
  ).length

  const isFull = event.status === 'full'

  return (
    <Link href={`/events/${event.id}`} className="block group">
      <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2 hover:border-brand hover:shadow-sm transition-all">
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-heading font-semibold text-sm text-brand-dark leading-tight">
            {event.title}
          </h2>
          <span
            className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
              isFull
                ? 'bg-red-100 text-red-700'
                : 'bg-brand-soft text-brand-active'
            }`}
          >
            {isFull ? 'Full' : 'Open'}
          </span>
        </div>

        <p className="text-sm text-brand-muted">
          {event.location ? event.location.name : 'Location TBD'}
          {event.court_count > 1 ? ` · ${event.court_count} courts` : ' · 1 court'}
        </p>

        <p className="text-sm text-brand-muted">{formatEventTime(event.starts_at)}</p>

        {(event.min_skill_level != null || event.max_skill_level != null) && (
          <p className="text-xs text-brand-muted">
            Skill:{' '}
            <span className="font-medium text-brand-body">
              {event.min_skill_level != null ? event.min_skill_level.toFixed(1) : '2.0'}
              {' – '}
              {event.max_skill_level != null ? event.max_skill_level.toFixed(1) : 'any'}
            </span>
          </p>
        )}

        <div className="flex items-center justify-between text-xs text-brand-muted pt-1 border-t border-brand-border">
          <span>Captain: {event.captain?.name ?? 'Unknown'}</span>
          <span className="font-medium">
            {joinedCount} / {event.max_players} players
          </span>
        </div>
      </div>
    </Link>
  )
}
