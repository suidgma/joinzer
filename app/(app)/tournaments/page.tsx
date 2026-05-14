import { createClient } from '@/lib/supabase/server'
import TournamentSearch from '@/components/features/tournaments/TournamentSearch'
import Link from 'next/link'
import type { TournamentListItem } from '@/lib/types'

type SearchParams = { showTest?: string }

export default async function TournamentsPage(props: { searchParams: Promise<SearchParams> }) {
  const supabase = createClient()
  const [{ data: { user } }, searchParams] = await Promise.all([
    supabase.auth.getUser(),
    props.searchParams,
  ])

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

  const isAdmin = !!user && user.email === process.env.ADMIN_EMAIL
  const showTest = isAdmin && searchParams.showTest === '1'

  let query = supabase
    .from('tournaments')
    .select(`
      id, name, description, start_date, start_time, estimated_end_time,
      status, visibility, registration_status,
      location:locations!location_id (name),
      organizer:profiles!organizer_id (name)
    `)
    .gte('start_date', today)
    .order('start_date', { ascending: true })

  if (!showTest) query = query.eq('dummy', false)

  const { data, error: queryError } = await query

  if (queryError) {
    console.error('[TournamentsPage] query error:', queryError)
  }

  const tournaments = (data ?? []) as unknown as TournamentListItem[]

  const isLoggedIn = !!user

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-bold text-brand-dark">Tournaments</h1>
        {isLoggedIn && (
          <Link
            href="/tournaments/create"
            className="bg-brand text-brand-dark text-sm rounded-xl px-4 py-2 font-semibold hover:bg-brand-hover transition-colors"
          >
            + Create
          </Link>
        )}
      </div>

      {tournaments.length === 0 ? (
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-8 text-center space-y-3">
          <p className="text-2xl">🏆</p>
          <p className="text-sm font-medium text-brand-dark">No tournaments yet</p>
          <p className="text-xs text-brand-muted">
            Check back soon for upcoming local pickleball tournaments.
          </p>
          {isLoggedIn && (
            <Link
              href="/tournaments/create"
              className="inline-block mt-2 bg-brand text-brand-dark text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-brand-hover transition-colors"
            >
              Create Tournament
            </Link>
          )}
        </div>
      ) : (
        <TournamentSearch tournaments={tournaments} isLoggedIn={isLoggedIn} />
      )}
    </main>
  )
}
