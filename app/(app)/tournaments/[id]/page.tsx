import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { TournamentDetail } from '@/lib/types'

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

function formatTime(timeStr: string) {
  const [h, m] = timeStr.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft:     'bg-yellow-100 text-yellow-800',
    published: 'bg-brand-soft text-brand-active',
    cancelled: 'bg-red-100 text-red-700',
    completed: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${styles[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function PlaceholderSection({ title }: { title: string }) {
  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-5 space-y-2">
      <h2 className="font-heading text-base font-bold text-brand-dark">{title}</h2>
      <p className="text-sm text-brand-muted">Coming in next build phase.</p>
    </div>
  )
}

export default async function TournamentDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data } = await supabase
    .from('tournaments')
    .select(`
      id, name, description, start_date, start_time, estimated_end_time,
      status, visibility, registration_status, organizer_id,
      location_id,
      location:locations!location_id (id, name, subarea),
      organizer:profiles!organizer_id (name),
      created_at, updated_at
    `)
    .eq('id', params.id)
    .single()

  if (!data) notFound()

  const tournament = data as unknown as TournamentDetail
  const isOrganizer = user?.id === tournament.organizer_id
  const regOpen = tournament.registration_status === 'open'

  const timeRange = tournament.estimated_end_time
    ? `${formatTime(tournament.start_time)} – ${formatTime(tournament.estimated_end_time)}`
    : formatTime(tournament.start_time)

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <Link href="/tournaments" className="text-brand-muted text-sm">← Back</Link>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-extrabold tracking-widest px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 uppercase">
              Tournament
            </span>
            <StatusBadge status={tournament.status} />
          </div>
          <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-semibold ${
            regOpen ? 'bg-brand-soft text-brand-active' : 'bg-gray-100 text-gray-500'
          }`}>
            {regOpen ? 'Registration Open' : 'Registration Closed'}
          </span>
        </div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">{tournament.name}</h1>
      </div>

      {/* Details card */}
      <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
        {tournament.location && (
          <div className="flex items-start gap-2">
            <span className="text-brand-muted text-xs pt-0.5">📍</span>
            <div>
              <p className="text-sm font-medium text-brand-dark">{tournament.location.name}</p>
              {tournament.location.subarea && (
                <p className="text-xs text-brand-muted">{tournament.location.subarea}</p>
              )}
            </div>
          </div>
        )}
        <div className="flex items-start gap-2">
          <span className="text-brand-muted text-xs pt-0.5">📅</span>
          <div>
            <p className="text-sm font-medium text-brand-dark">{formatDate(tournament.start_date)}</p>
            <p className="text-xs text-brand-muted">{timeRange}</p>
          </div>
        </div>
        {tournament.organizer && (
          <div className="flex items-start gap-2">
            <span className="text-brand-muted text-xs pt-0.5">👤</span>
            <p className="text-sm text-brand-dark">Organizer: {tournament.organizer.name}</p>
          </div>
        )}
        {tournament.description && (
          <p className="text-sm text-brand-body leading-relaxed border-t border-brand-border pt-3">
            {tournament.description}
          </p>
        )}
      </div>

      {/* Organizer actions */}
      {isOrganizer && (
        <Link
          href={`/tournaments/${tournament.id}/edit`}
          className="block w-full text-center py-2.5 rounded-xl border border-brand-border text-sm font-medium text-brand-active hover:bg-brand-soft transition-colors"
        >
          Edit Tournament
        </Link>
      )}

      {/* Placeholder sections for future prompts */}
      <PlaceholderSection title="Divisions" />
      <PlaceholderSection title="Registration" />
      <PlaceholderSection title="Format" />
      <PlaceholderSection title="Matches / Brackets" />
    </main>
  )
}
