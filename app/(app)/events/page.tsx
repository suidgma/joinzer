import { createClient } from '@/lib/supabase/server'
import EventCard from '@/components/features/events/EventCard'
import EventFilters from '@/components/features/events/EventFilters'
import EventCalendar from '@/components/features/events/EventCalendar'
import AvailabilityButton from '@/components/features/availability/AvailabilityButton'
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
  type?: string
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
  const typeFilter = searchParams.type ?? null

  // Build base query
  let query = supabase
    .from('events')
    .select(`
      id, title, starts_at, duration_minutes, court_count, max_players, status,
      session_type, price_cents, notes, min_skill_level, max_skill_level, location_id,
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

  const { data } = await query.order('starts_at', { ascending: true })

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

  // Type filter
  if (typeFilter === 'game') {
    events = events.filter((ev) => ev.session_type === 'game')
  } else if (typeFilter === 'clinic') {
    events = events.filter((ev) => ev.session_type === 'free_clinic' || ev.session_type === 'paid_clinic')
  }

  // Sort: clinics first, then by starts_at ASC within each group
  events.sort((a, b) => {
    const aIsClinic = (a.session_type === 'free_clinic' || a.session_type === 'paid_clinic') ? 0 : 1
    const bIsClinic = (b.session_type === 'free_clinic' || b.session_type === 'paid_clinic') ? 0 : 1
    if (aIsClinic !== bIsClinic) return aIsClinic - bIsClinic
    return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
  })

  // Fetch locations for the filter dropdown
  const { data: locationData } = await supabase
    .from('locations')
    .select('id, name, court_count, access_type, subarea')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  const locations = (locationData ?? []) as LocationOption[]

  // Current user + their active availability
  const { data: { user } } = await supabase.auth.getUser()
  const todayVegas = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const { data: availRows } = user
    ? await supabase
        .from('player_availability')
        .select('date, time_window')
        .eq('user_id', user.id)
        .gte('date', todayVegas)
        .order('date', { ascending: true })
    : { data: null }

  // Group by earliest date to show current availability
  const existingAvailability = availRows && availRows.length > 0
    ? { date: availRows[0].date, timeWindows: availRows.map((r) => r.time_window as string) }
    : null

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-end justify-between gap-3">
        {user ? (
          <div className="space-y-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-muted">Availability</p>
            <AvailabilityButton
              userId={user.id}
              locations={locations}
              existing={existingAvailability ?? null}
            />
          </div>
        ) : <div />}
        <Link
          href="/events/create"
          className="shrink-0 bg-brand text-brand-dark text-sm rounded-xl px-4 py-2 font-semibold hover:bg-brand-hover transition-colors whitespace-nowrap"
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
