import { createClient } from '@/lib/supabase/server'
import CompeteClient from './CompeteClient'

export default async function CompetePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: leagues }, { data: tournaments }, { data: tournamentEvents }] = await Promise.all([
    supabase
      .from('leagues')
      .select('id, name, format, skill_level, location_name, start_date, end_date, max_players, registration_status')
      .eq('status', 'active')
      .order('start_date', { ascending: true }),
    supabase
      .from('tournaments')
      .select('id, name, location_name, start_date, end_date, status, cost_cents')
      .not('status', 'eq', 'cancelled')
      .order('start_date', { ascending: true }),
    supabase
      .from('tournament_events')
      .select('tournament_id, skill_level'),
  ])

  // Build a map of tournament_id → distinct skill levels from its events
  const eventSkillMap = new Map<string, Set<string>>()
  for (const ev of tournamentEvents ?? []) {
    if (!ev.skill_level) continue
    if (!eventSkillMap.has(ev.tournament_id)) eventSkillMap.set(ev.tournament_id, new Set())
    eventSkillMap.get(ev.tournament_id)!.add(ev.skill_level)
  }

  const tournamentList = (tournaments ?? []).map((t) => ({
    ...t,
    eventSkillLevels: Array.from(eventSkillMap.get(t.id) ?? []),
  }))

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <h1 className="font-heading text-xl font-bold text-brand-dark">Compete</h1>
      <CompeteClient
        leagues={leagues ?? []}
        tournaments={tournamentList}
        isLoggedIn={!!user}
      />
    </main>
  )
}
