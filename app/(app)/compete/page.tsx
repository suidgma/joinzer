import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

const FORMAT_LABELS: Record<string, string> = {
  mens_doubles: "Men's Doubles",
  womens_doubles: "Women's Doubles",
  mixed_doubles: 'Mixed Doubles',
  coed_doubles: 'Coed Doubles',
  singles: 'Singles',
  custom: 'Custom',
}

const SKILL_LABELS: Record<string, string> = {
  beginner: 'Beginner',
  beginner_plus: 'Beginner+',
  intermediate: 'Intermediate',
  intermediate_plus: 'Intermediate+',
  advanced: 'Advanced',
}

const REG_BADGE: Record<string, { label: string; cls: string }> = {
  open:         { label: 'Open',         cls: 'bg-brand text-brand-dark' },
  waitlist_only:{ label: 'Waitlist',     cls: 'bg-yellow-100 text-yellow-800' },
  closed:       { label: 'Closed',       cls: 'bg-red-100 text-red-700' },
  upcoming:     { label: 'Coming Soon',  cls: 'bg-brand-soft text-brand-muted' },
}

const TOURN_BADGE: Record<string, { label: string; cls: string }> = {
  upcoming:             { label: 'Coming Soon',        cls: 'bg-brand-soft text-brand-muted' },
  registration_open:    { label: 'Registration Open',  cls: 'bg-brand text-brand-dark' },
  registration_closed:  { label: 'Reg. Closed',        cls: 'bg-red-100 text-red-700' },
  in_progress:          { label: 'In Progress',         cls: 'bg-yellow-100 text-yellow-800' },
  completed:            { label: 'Completed',           cls: 'bg-brand-soft text-brand-muted' },
  cancelled:            { label: 'Cancelled',           cls: 'bg-red-100 text-red-700' },
}

export default async function CompetePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: leagues }, { data: tournaments }] = await Promise.all([
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
  ])

  return (
    <main className="max-w-lg mx-auto p-4 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-bold text-brand-dark">Compete</h1>
      </div>

      {/* Leagues section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base font-bold text-brand-dark">Leagues</h2>
          {user && (
            <Link href="/compete/leagues/create" className="text-xs text-brand-active font-medium underline underline-offset-2">
              + Create
            </Link>
          )}
        </div>

        {!leagues?.length ? (
          <p className="text-sm text-brand-muted text-center py-8">No active leagues yet.</p>
        ) : (
          <div className="space-y-3">
            {leagues.map((league) => {
              const badge = REG_BADGE[league.registration_status] ?? REG_BADGE.upcoming
              const startDate = league.start_date
                ? new Date(league.start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : null
              const endDate = league.end_date
                ? new Date(league.end_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : null

              return (
                <Link
                  key={league.id}
                  href={`/compete/leagues/${league.id}`}
                  className="block bg-brand-surface border border-brand-border rounded-2xl p-4 hover:border-brand transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-dark truncate">{league.name}</p>
                      <p className="text-xs text-brand-muted mt-0.5">
                        {FORMAT_LABELS[league.format]} · {SKILL_LABELS[league.skill_level]}
                      </p>
                      {league.location_name && (
                        <p className="text-xs text-brand-muted mt-0.5">📍 {league.location_name}</p>
                      )}
                      {(startDate || endDate) && (
                        <p className="text-xs text-brand-muted mt-0.5">
                          📅 {startDate}{endDate ? ` – ${endDate}` : ''}
                        </p>
                      )}
                    </div>
                    <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Tournaments section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base font-bold text-brand-dark">Tournaments</h2>
          {user && (
            <Link href="/compete/tournaments/create" className="text-xs text-brand-active font-medium underline underline-offset-2">
              + Create
            </Link>
          )}
        </div>

        {!tournaments?.length ? (
          <p className="text-sm text-brand-muted text-center py-8">No tournaments listed yet.</p>
        ) : (
          <div className="space-y-3">
            {tournaments.map((t) => {
              const badge = TOURN_BADGE[t.status] ?? TOURN_BADGE.upcoming
              const startDate = t.start_date
                ? new Date(t.start_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : null
              const endDate = t.end_date
                ? new Date(t.end_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : null
              const cost = t.cost_cents ? `$${(t.cost_cents / 100).toFixed(0)}` : 'Free'

              return (
                <Link
                  key={t.id}
                  href={`/compete/tournaments/${t.id}`}
                  className="block bg-brand-surface border border-brand-border rounded-2xl p-4 hover:border-brand transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-dark truncate">{t.name}</p>
                      {t.location_name && (
                        <p className="text-xs text-brand-muted mt-0.5">📍 {t.location_name}</p>
                      )}
                      {(startDate || endDate) && (
                        <p className="text-xs text-brand-muted mt-0.5">
                          📅 {startDate}{endDate ? ` – ${endDate}` : ''}
                        </p>
                      )}
                      <p className="text-xs text-brand-muted mt-0.5">💰 {cost}</p>
                    </div>
                    <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
