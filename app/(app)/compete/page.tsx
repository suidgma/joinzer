import { createClient } from '@/lib/supabase/server'
import CompeteClient from './CompeteClient'

export default async function CompetePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: leagues } = await supabase
    .from('leagues')
    .select('id, name, format, skill_level, location_name, start_date, end_date, max_players, registration_status')
    .eq('status', 'active')
    .order('start_date', { ascending: true })

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
