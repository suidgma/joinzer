import { createClient } from '@/lib/supabase/server'
import CompeteClient from './CompeteClient'
import UpcomingPastToggle from '@/components/features/UpcomingPastToggle'

type SearchParams = { showTest?: string; when?: string }

export default async function CompetePage(props: { searchParams: Promise<SearchParams> }) {
  const supabase = createClient()
  const [{ data: { user } }, searchParams] = await Promise.all([
    supabase.auth.getUser(),
    props.searchParams,
  ])

  let isAdmin = false
  if (user && searchParams.showTest === '1') {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()
    isAdmin = profile?.is_admin ?? false
  }
  const showTest = isAdmin && searchParams.showTest === '1'
  const when: 'upcoming' | 'past' = searchParams.when === 'past' ? 'past' : 'upcoming'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

  let query = supabase
    .from('leagues')
    .select('id, name, format, status, skill_min, skill_max, location_name, start_date, end_date, max_players, registration_status, creator:profiles!created_by (name)')

  // Past = wrapped up: completed, or an active season whose end_date has passed (excludes
  // cancelled); newest-ended first. Upcoming/current = active with no end_date or one still ahead.
  query = when === 'past'
    ? query.or(`status.eq.completed,and(status.eq.active,end_date.lt.${today})`).order('end_date', { ascending: false, nullsFirst: false })
    : query.eq('status', 'active').or(`end_date.is.null,end_date.gte.${today}`).order('start_date', { ascending: true })

  if (!showTest) query = query.eq('dummy', false)

  const { data: leaguesRaw } = await query
  // Supabase infers many-to-one nested joins as arrays; cast to the correct object shape
  const leagues = (leaguesRaw ?? []) as unknown as Parameters<typeof CompeteClient>[0]['leagues']

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-bold text-brand-dark">Compete</h1>
        <UpcomingPastToggle basePath="/leagues" searchParams={searchParams} when={when} />
      </div>
      <CompeteClient
        leagues={leagues}
        isLoggedIn={!!user}
        when={when}
      />
    </main>
  )
}
