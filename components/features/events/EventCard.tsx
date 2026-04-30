import Link from 'next/link'
import { formatEventTime } from '@/lib/utils/date'
import type { EventListItem } from '@/lib/types'

export default function EventCard({ event }: { event: EventListItem }) {
  const joinedCount = event.event_participants.filter(
    (p) => p.participant_status === 'joined'
  ).length

  const isFull    = event.status === 'full'
  const isClinic  = event.session_type === 'clinic'

  return (
    <Link href={`/events/${event.id}`} className="block group">
      {isClinic ? (
        // ── Clinic card ────────────────────────────────────────────
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-2 hover:border-amber-400 hover:shadow-sm transition-all">
          {/* Badges row */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold tracking-widest px-2 py-0.5 rounded-full bg-amber-400 text-amber-900 uppercase">
              Free Clinic
            </span>
            <span
              className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                isFull ? 'bg-red-100 text-red-700' : 'bg-brand-soft text-brand-active'
              }`}
            >
              {isFull ? 'Full' : 'Open'}
            </span>
          </div>

          <h2 className="font-heading font-semibold text-sm text-amber-900 leading-tight">
            {event.title}
          </h2>

          <p className="text-sm text-amber-800">
            {event.location ? event.location.name : 'Location TBD'}
            {event.court_count > 1 ? ` · ${event.court_count} courts` : ' · 1 court'}
          </p>

          <p className="text-sm text-amber-800">{formatEventTime(event.starts_at)}</p>

          {(event.min_skill_level != null || event.max_skill_level != null) && (
            <p className="text-xs text-amber-700">
              Skill:{' '}
              <span className="font-medium">
                {event.min_skill_level != null ? event.min_skill_level.toFixed(1) : '2.0'}
                {' – '}
                {event.max_skill_level != null ? event.max_skill_level.toFixed(1) : '& up'}
              </span>
            </p>
          )}

          {event.notes && (
            <p className="text-xs text-amber-700 leading-relaxed line-clamp-2">{event.notes}</p>
          )}

          <div className="flex items-center justify-between text-xs text-amber-700 pt-1 border-t border-amber-200">
            <span>Host: {event.captain?.name ?? 'Unknown'}</span>
            <span className="font-medium">
              {joinedCount} / {event.max_players} spots
            </span>
          </div>
        </div>
      ) : (
        // ── Regular game card ──────────────────────────────────────
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2 hover:border-brand hover:shadow-sm transition-all">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-heading font-semibold text-sm text-brand-dark leading-tight">
              {event.title}
            </h2>
            <span
              className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                isFull ? 'bg-red-100 text-red-700' : 'bg-brand-soft text-brand-active'
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
                {event.max_skill_level != null ? event.max_skill_level.toFixed(1) : '& up'}
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
      )}
    </Link>
  )
}
