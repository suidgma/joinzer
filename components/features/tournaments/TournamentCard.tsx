import Link from 'next/link'
import type { TournamentListItem } from '@/lib/types'

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function formatTime(timeStr: string) {
  const [h, m] = timeStr.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

export default function TournamentCard({ tournament }: { tournament: TournamentListItem }) {
  const regOpen = tournament.registration_status === 'open'
  const isDraft = tournament.status === 'draft'

  const timeRange = tournament.estimated_end_time
    ? `${formatTime(tournament.start_time)} – ${formatTime(tournament.estimated_end_time)}`
    : formatTime(tournament.start_time)

  return (
    <Link href={`/tournaments/${tournament.id}`} className="block group">
      <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2 hover:border-brand hover:shadow-sm transition-all">

        {/* Badges */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-extrabold tracking-widest px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 uppercase">
              Tournament
            </span>
            {isDraft && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 uppercase">
                Draft
              </span>
            )}
          </div>
          <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
            regOpen ? 'bg-brand-soft text-brand-active' : 'bg-gray-100 text-gray-500'
          }`}>
            {regOpen ? 'Open' : 'Closed'}
          </span>
        </div>

        {/* Name */}
        <h2 className="font-heading font-semibold text-sm text-brand-dark leading-tight">
          {tournament.name}
        </h2>

        {/* Location */}
        <p className="text-sm text-brand-muted">
          {tournament.location?.name ?? 'Location TBD'}
        </p>

        {/* Date & time */}
        <p className="text-sm text-brand-muted">
          {formatDate(tournament.start_date)} · {timeRange}
        </p>

        {/* Description */}
        {tournament.description && (
          <p className="text-xs text-brand-muted line-clamp-2 leading-relaxed">
            {tournament.description}
          </p>
        )}

        {/* Footer */}
        {tournament.organizer && (
          <div className="pt-1 border-t border-brand-border text-xs text-brand-muted">
            Organizer: {tournament.organizer.name}
          </div>
        )}
      </div>
    </Link>
  )
}
