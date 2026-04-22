import { createClient } from '@/lib/supabase/server'
import EventCard from '@/components/features/events/EventCard'
import EventFilters from '@/components/features/events/EventFilters'
import EventCalendar from '@/components/features/events/EventCalendar'
import type { EventListItem, LocationOption } from '@/lib/types'
import Link from 'next/link'
import { Suspense } from 'react'

// Vegas is UTC-7 (PDT) or UTC-8 (PST). Use -7 for summer pilot.
const VEGAS_OFFSET_HOURS = 7

function vegasHour(isoStr: string): number {
  const utcHour = new Date(isoStr).getUTCHours()
  return (utcHour - VEGAS_OFFSET_HOURS + 24) % 24
}

type SearchParams = {
  view?: string
  date?: string
  skill?: string
  time?: string
  location?: string
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const supabase = createClient()

  const view = searchParams.view ?? 'list'
  const dateFilter = searchParams.date ?? null
  const skillFilter = searchParams.skill ? parseFloat(searchParams.skill) : null
  const timeFilter = searchParams.time ?? null
  const locationFilter = searchParams.location ?? null

  // Build base query
  let query = supabase
    .from('events')
    .select(`
      id, title, starts_at, duration_minutes, court_count, max_players, status,
      min_skill_level, max_skill_level, location_id,
      location:locations!location_id (name, court_count),
      captain:profiles!captain_user_id (name),
      event_participants!event_id (participant_status)
    `)
    .in('status', ['open', 'full'])

  // Date filter — calendar fetches the whole current month regardless
  if (view === 'calendar' && !dateFilter) {
    // Fetch all future events so the calendar can show dots across months
    query = query.gte('starts_at', new Date().toISOString())
  } else if (dateFilter) {
    const start = new Date(`${dateFilter}T00:00:00-0${VEGAS_OFFSET_HOURS}:00`).toISOString()
    const end = new Date(`${dateFilter}T23:59:59-0${VEGAS_OFFSET_HOURS}:00`).toISOString()
    query = query.gte('starts_at', start).lte('starts_at', end)
  } else {
    query = query.gte('starts_at', new Date().toISOString())
  }

  // Location filter
  if (locationFilter) {
    query = query.eq('location_id', locationFilter)
  }

  const { data } = await query

  let events = (data ?? []) as unknown as EventListItem[]

  // Skill filter (JS post-filter — handles NULLs cleanly)
  if (skillFilter !== null) {
    events = events.filter((ev) => {
      const minOk = ev.min_skill_level == null || ev.min_skill_level <= skillFilter
      const maxOk = ev.max_skill_level == null || ev.max_skill_level >= skillFilter
      return minOk && maxOk
    })
  }

  // Time-of-day filter
  if (timeFilter) {
    events = events.filter((ev) => {
      const h = vegasHour(ev.starts_at)
      if (timeFilter === 'morning') return h >= 6 && h < 12
      if (timeFilter === 'afternoon') return h >= 12 && h < 17
      if (timeFilter === 'evening') return h >= 17
      return true
    })
  }

  // Sort: facility court count DESC, then title ASC
  events.sort((a, b) => {
    const aCourts = a.location?.court_count ?? 0
    const bCourts = b.location?.court_count ?? 0
    if (bCourts !== aCourts) return bCourts - aCourts
    return a.title.localeCompare(b.title)
  })

  // Fetch locations for the filter dropdown
  const { data: locationData } = await supabase
    .from('locations')
    .select('id, name, court_count, access_type, subarea')
    .eq('is_active', true)
    .order('name', { ascending: true })

  const locations = (locationData ?? []) as LocationOption[]

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-bold text-brand-dark">Sessions</h1>
        <Link
          href="/events/create"
          className="bg-brand text-brand-dark text-sm rounded-xl px-4 py-2 font-semibold hover:bg-brand-hover transition-colors"
        >
          + Create
        </Link>
      </div>

      <Suspense>
        <EventFilters locations={locations} view={view} />
      </Suspense>

      {view === 'calendar' ? (
        <Suspense>
          <EventCalendar events={events} selectedDate={dateFilter} />
        </Suspense>
      ) : (
        <>
          {events.length === 0 ? (
            <p className="text-sm text-brand-muted text-center py-12">
              No sessions match your filters.
            </p>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  )
}
