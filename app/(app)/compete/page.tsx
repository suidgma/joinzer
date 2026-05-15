import { createClient } from '@/lib/supabase/server'
import CompeteClient from './CompeteClient'

type SearchParams = { showTest?: string }

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

  let query = supabase
    .from('leagues')
    .select('id, name, format, skill_level, location_name, start_date, end_date, max_players, registration_status, creator:profiles!created_by (name)')
    .eq('status', 'active')
    .order('start_date', { ascending: true })

  if (!showTest) query = query.eq('dummy', false)

  const { data: leaguesRaw } = await query
  // Supabase infers many-to-one nested joins as arrays; cast to the correct object shape
  const leagues = (leaguesRaw ?? []) as unknown as Parameters<typeof CompeteClient>[0]['leagues']

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <h1 className="font-heading text-xl font-bold text-brand-dark">Compete</h1>
      <CompeteClient
        leagues={leagues}
        isLoggedIn={!!user}
      />
    </main>
  )
}
