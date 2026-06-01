import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import TournamentSearch from '@/components/features/tournaments/TournamentSearch'
import type { TournamentListItem } from '@/lib/types'

export const metadata = {
  title: 'Tournaments — Joinzer',
  description: 'Browse upcoming pickleball tournaments in Las Vegas. Find events across all skill levels.',
}

export default async function BrowseTournamentsPage() {
  const supabase = createClient()

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

  const { data } = await supabase
    .from('tournaments')
    .select(`
      id, name, description, start_date, start_time, estimated_end_time,
      status, visibility, registration_status,
      location:locations!location_id (name),
      organizer:profiles!organizer_id (name)
    `)
    .gte('start_date', today)
    .eq('dummy', false)
    .neq('visibility', 'private')
    .order('start_date', { ascending: true })

  const tournaments = (data ?? []) as unknown as TournamentListItem[]

  return (
    <main className="max-w-lg mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-brand-dark">Tournaments</h1>
        <p className="text-sm text-brand-muted mt-1">
          Upcoming tournaments in the Las Vegas area.{' '}
          <Link href="/login" className="text-brand-active font-medium hover:underline">
            Create a free account
          </Link>{' '}
          to register.
        </p>
      </div>

      {tournaments.length === 0 ? (
        <div className="bg-brand-soft border border-brand-border rounded-2xl p-10 text-center space-y-3">
          <p className="text-2xl">🏆</p>
          <p className="text-sm font-medium text-brand-dark">No upcoming tournaments</p>
          <p className="text-xs text-brand-muted">Check back soon — new tournaments are added regularly.</p>
          <Link
            href="/login"
            className="inline-block mt-2 bg-brand text-brand-dark text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-brand-hover transition-colors"
          >
            Create a free account
          </Link>
        </div>
      ) : (
        <TournamentSearch tournaments={tournaments} isLoggedIn={false} />
      )}
    </main>
  )
}
