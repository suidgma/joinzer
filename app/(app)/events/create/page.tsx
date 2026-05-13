import { createClient } from '@/lib/supabase/server'
import CreateEventForm from '@/components/features/events/CreateEventForm'
import type { LocationOption } from '@/lib/types'
import Link from 'next/link'

export type EventDefaults = {
  title: string
  locationId: string
  time: string
  durationMinutes: number
  courtCount: number
  playersPerCourt: number
  minSkill: string
  maxSkill: string
  notes: string
  sessionType: 'game' | 'free_clinic' | 'paid_clinic'
  priceCents: number
}

export default async function CreateEventPage(
  props: {
    searchParams: Promise<{ from?: string }>
  }
) {
  const searchParams = await props.searchParams;
  const supabase = createClient()

  const [{ data: locationsData }, sourceResult] = await Promise.all([
    supabase
      .from('locations')
      .select('id, name, court_count, access_type, subarea')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    searchParams.from
      ? supabase
          .from('events')
          .select('title, location_id, starts_at, duration_minutes, court_count, players_per_court, min_skill_level, max_skill_level, notes, session_type, price_cents')
          .eq('id', searchParams.from)
          .single()
      : Promise.resolve({ data: null }),
  ])

  const locations = (locationsData ?? []) as LocationOption[]

  let defaults: EventDefaults | undefined
  if (sourceResult.data) {
    const src = sourceResult.data as any
    const startsAt = new Date(src.starts_at)
    const hh = String(startsAt.getHours()).padStart(2, '0')
    const mm = String(startsAt.getMinutes()).padStart(2, '0')
    defaults = {
      title: src.title,
      locationId: src.location_id,
      time: `${hh}:${mm}`,
      durationMinutes: src.duration_minutes,
      courtCount: src.court_count,
      playersPerCourt: src.players_per_court,
      minSkill: src.min_skill_level != null ? String(src.min_skill_level) : '',
      maxSkill: src.max_skill_level != null ? String(src.max_skill_level) : '',
      notes: src.notes ?? '',
      sessionType: src.session_type ?? 'game',
      priceCents: src.price_cents ?? 1000,
    }
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <Link href="/events" className="text-sm text-gray-500 hover:text-black">
        ← Back to play
      </Link>
      <h1 className="text-xl font-bold">{defaults ? 'Duplicate Session' : 'Create Play'}</h1>
      {defaults && (
        <p className="text-sm text-brand-muted">All details copied — just pick a new date.</p>
      )}
      <CreateEventForm locations={locations} defaults={defaults} />
    </main>
  )
}
