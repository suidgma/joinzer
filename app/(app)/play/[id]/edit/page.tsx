import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import EditEventForm from '@/components/features/events/EditEventForm'
import type { LocationOption } from '@/lib/types'

export default async function EditEventPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: event }, { data: locationData }] = await Promise.all([
    supabase
      .from('events')
      .select('id, title, starts_at, duration_minutes, court_count, players_per_court, max_players, notes, status, session_type, price_cents, registration_closes_at, no_refund_date, refund_policy, prizes, price_tiers, captain_user_id, skill_min, skill_max, location_id')
      .eq('id', params.id)
      .single(),
    supabase
      .from('locations')
      .select('id, name, court_count, access_type, subarea, address, city, state, zip_code, country')
      .eq('is_active', true)
      .or(`status.eq.approved,created_by.eq.${user.id}`) // approved venues + your own pending ones
      .order('sort_order', { ascending: true }),
  ])

  if (!event) notFound()

  // Only the captain can edit
  if (event.captain_user_id !== user.id) redirect(`/play/${params.id}`)

  const locations = (locationData ?? []) as LocationOption[]

  let canCreatePaid = false
  if (user) {
    const { data: prof } = await supabase.from('profiles').select('can_create_paid_events').eq('id', user.id).single()
    canCreatePaid = !!prof?.can_create_paid_events
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <Link href={`/play/${params.id}`} className="text-sm text-gray-500 hover:text-black">
        ← Back to play
      </Link>
      <h1 className="text-xl font-bold">Edit Play</h1>
      <EditEventForm event={event} locations={locations} canCreatePaid={canCreatePaid} />
    </main>
  )
}
