import { createClient } from '@/lib/supabase/server'

async function fetchStats() {
  const supabase = createClient()

  const [players, courts, leagues, tournaments] = await Promise.all([
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('dummy', false),
    supabase
      .from('locations')
      .select('id', { count: 'exact', head: true }),
    supabase
      .from('leagues')
      .select('id', { count: 'exact', head: true })
      .in('status', ['registration_open', 'in_progress', 'active']),
    supabase
      .from('tournaments')
      .select('id', { count: 'exact', head: true })
      .in('status', ['registration_open', 'upcoming', 'in_progress']),
  ])

  return {
    players: players.count ?? 0,
    courts: courts.count ?? 0,
    leagues: leagues.count ?? 0,
    tournaments: tournaments.count ?? 0,
  }
}

export default async function StatsSection() {
  const stats = await fetchStats()

  const items = [
    { value: `${stats.players}+`, label: 'Players' },
    { value: `${stats.courts}+`, label: 'Courts listed' },
    { value: String(stats.leagues), label: 'Active leagues' },
    { value: String(stats.tournaments), label: 'Open tournaments' },
  ]

  return (
    <section className="py-10 bg-brand-soft border-y border-brand-border">
      <div className="max-w-4xl mx-auto px-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {items.map((item) => (
            <div key={item.label}>
              <p className="font-heading text-3xl sm:text-4xl font-extrabold text-brand-dark">{item.value}</p>
              <p className="text-xs text-brand-muted font-medium mt-1 uppercase tracking-wide">{item.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
