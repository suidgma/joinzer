import { createClient } from '@/lib/supabase/server'
import CompeteClient from './CompeteClient'

type SearchParams = { showTest?: string }

export default async function CompetePage(props: { searchParams: Promise<SearchParams> }) {
  const supabase = createClient()
  const [{ data: { user } }, searchParams] = await Promise.all([
    supabase.auth.getUser(),
    props.searchParams,
  ])

  const isAdmin = !!user && user.email === process.env.ADMIN_EMAIL
  const showTest = isAdmin && searchParams.showTest === '1'

  let query = supabase
    .from('leagues')
    .select('id, name, format, skill_level, location_name, start_date, end_date, max_players, registration_status')
    .eq('status', 'active')
    .order('start_date', { ascending: true })

  if (!showTest) query = query.eq('dummy', false)

  const { data: leagues } = await query

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <h1 className="font-heading text-xl font-bold text-brand-dark">Compete</h1>
      <CompeteClient
        leagues={leagues ?? []}
        isLoggedIn={!!user}
      />
    </main>
  )
}
