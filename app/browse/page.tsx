import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import BrowseClient from './BrowseClient'
import type { EventListItem, TournamentListItem, LocationOption } from '@/lib/types'

export const metadata: Metadata = {
  title: 'Browse Local Pickleball — Joinzer',
  description: 'Explore open play, leagues, tournaments, clinics, and courts in Las Vegas.',
}

export default async function BrowsePage() {
  const supabase = createClient()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

  const [{ data: eventsRaw }, { data: leaguesRaw }, { data: tournamentsRaw }, { data: locationsRaw }] =
    await Promise.all([
      supabase
        .from('events')
        .select(`
          id, title, starts_at, duration_minutes, court_count, max_players, status,
          session_type, price_cents, notes, skill_min, skill_max, location_id,
          location:locations!location_id (name, court_count),
          captain:profiles!captain_user_id (name),
          event_participants!event_id (participant_status)
        `)
        .in('status', ['open', 'full'])
        .gte('starts_at', new Date().toISOString())
        .order('starts_at', { ascending: true })
        .limit(50),

      supabase
        .from('leagues')
        .select('id, name, format, skill_min, skill_max, location_name, start_date, end_date, max_players, registration_status, creator:profiles!created_by (name)')
        .eq('status', 'active')
        .eq('visibility', 'public')
        .eq('dummy', false)
        .order('start_date', { ascending: true }),

      supabase
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
        .order('start_date', { ascending: true }),

      supabase
        .from('locations')
        .select('id, name, court_count, access_type, subarea')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .limit(60),
    ])

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <BrowseClient
        events={(eventsRaw ?? []) as unknown as EventListItem[]}
        leagues={(leaguesRaw ?? []) as any[]}
        tournaments={(tournamentsRaw ?? []) as unknown as TournamentListItem[]}
        locations={(locationsRaw ?? []) as unknown as LocationOption[]}
      />
    </main>
  )
}
