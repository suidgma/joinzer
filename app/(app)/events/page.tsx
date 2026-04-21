import { createClient } from '@/lib/supabase/server'
import EventCard from '@/components/features/events/EventCard'
import type { EventListItem } from '@/lib/types'
import Link from 'next/link'

export default async function EventsPage() {
  const supabase = createClient()

  const { data } = await supabase
    .from('events')
    .select(`
      id, title, starts_at, duration_minutes, max_players, status,
      location:locations!location_id (name, court_count),
      captain:profiles!captain_user_id (name),
      event_participants!event_id (participant_status)
    `)
    .in('status', ['open', 'full'])
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })

  const events = (data ?? []) as unknown as EventListItem[]

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Sessions</h1>
        <Link
          href="/events/create"
          className="bg-black text-white text-sm rounded-lg px-4 py-2 font-medium"
        >
          + Create
        </Link>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-12">
          No upcoming sessions. Be the first to create one!
        </p>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </main>
  )
}
