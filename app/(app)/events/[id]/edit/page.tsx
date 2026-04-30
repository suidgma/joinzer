import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import EditEventForm from '@/components/features/events/EditEventForm'

export default async function EditEventPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: event } = await supabase
    .from('events')
    .select('id, title, starts_at, duration_minutes, court_count, players_per_court, max_players, notes, status, session_type, price_cents, captain_user_id')
    .eq('id', params.id)
    .single()

  if (!event) notFound()

  // Only the captain can edit
  if (event.captain_user_id !== user.id) redirect(`/events/${params.id}`)

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <Link href={`/events/${params.id}`} className="text-sm text-gray-500 hover:text-black">
        ← Back to play
      </Link>
      <h1 className="text-xl font-bold">Edit Play</h1>
      <EditEventForm event={event} />
    </main>
  )
}
