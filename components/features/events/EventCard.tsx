import Link from 'next/link'
import { formatEventTime } from '@/lib/utils/date'
import type { EventListItem } from '@/lib/types'

export default function EventCard({ event }: { event: EventListItem }) {
  const joinedCount = event.event_participants.filter(
    (p) => p.participant_status === 'joined'
  ).length

  const isFull = event.status === 'full'

  return (
    <Link href={`/events/${event.id}`} className="block">
      <div className="border rounded-xl p-4 space-y-2 hover:bg-gray-50 transition-colors">
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-semibold text-sm leading-tight">{event.title}</h2>
          <span
            className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
              isFull
                ? 'bg-red-100 text-red-700'
                : 'bg-green-100 text-green-700'
            }`}
          >
            {isFull ? 'Full' : 'Open'}
          </span>
        </div>

        <p className="text-sm text-gray-600">
          {event.location
            ? `${event.location.name} (${event.location.court_count} courts)`
            : 'Location TBD'}
        </p>

        <p className="text-sm text-gray-500">{formatEventTime(event.starts_at)}</p>

        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Captain: {event.captain?.name ?? 'Unknown'}</span>
          <span>
            {joinedCount} / {event.max_players} players
          </span>
        </div>
      </div>
    </Link>
  )
}
