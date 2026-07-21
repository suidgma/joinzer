import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import CompeteClient from '@/app/(app)/leagues/CompeteClient'

export const metadata = {
  title: 'Leagues — Joinzer',
  description: 'Browse active pickleball leagues in Las Vegas. Find a league that fits your skill level and schedule.',
}

export default async function BrowseLeaguesPage() {
  const supabase = createClient()

  const { data: leaguesRaw } = await supabase
    .from('leagues')
    .select('id, name, format, skill_min, skill_max, location_name, start_date, end_date, max_players, registration_status, creator:profiles!created_by (name)')
    .eq('status', 'active')
    .eq('visibility', 'public')
    .eq('dummy', false)
    .order('start_date', { ascending: true })

  const leagues = (leaguesRaw ?? []) as unknown as Parameters<typeof CompeteClient>[0]['leagues']

  return (
    <main className="max-w-lg mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-brand-dark">Leagues</h1>
        <p className="text-sm text-brand-muted mt-1">
          Active leagues in the Las Vegas area.{' '}
          <Link href="/login" className="text-brand-active font-medium hover:underline">
            Create a free account
          </Link>{' '}
          to register.
        </p>
      </div>

      {leagues.length === 0 ? (
        <div className="bg-brand-soft border border-brand-border rounded-2xl p-10 text-center space-y-3">
          <p className="text-2xl">📊</p>
          <p className="text-sm font-medium text-brand-dark">No active leagues right now</p>
          <p className="text-xs text-brand-muted">Check back soon — new leagues are added regularly.</p>
          <Link
            href="/login"
            className="inline-block mt-2 bg-brand text-brand-dark text-sm font-semibold px-6 py-2.5 rounded-xl hover:bg-brand-hover transition-colors"
          >
            Get notified when leagues open
          </Link>
        </div>
      ) : (
        <CompeteClient leagues={leagues} isLoggedIn={false} />
      )}
    </main>
  )
}
