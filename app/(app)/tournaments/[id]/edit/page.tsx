import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import EditTournamentForm from '@/components/features/tournaments/EditTournamentForm'
import type { TournamentDetail, LocationOption } from '@/lib/types'

export default async function EditTournamentPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: tournamentData }, { data: locationData }] = await Promise.all([
    supabase
      .from('tournaments')
      .select(`
        id, name, description, start_date, start_time, estimated_end_time,
        status, visibility, registration_status, organizer_id,
        location_id,
        location:locations!location_id (id, name, subarea),
        organizer:profiles!organizer_id (name),
        created_at, updated_at
      `)
      .eq('id', params.id)
      .single(),
    supabase
      .from('locations')
      .select('id, name, court_count, access_type, subarea')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
  ])

  if (!tournamentData) notFound()

  const tournament = tournamentData as unknown as TournamentDetail

  if (tournament.organizer_id !== user.id) redirect(`/tournaments/${params.id}`)

  const locations = (locationData ?? []) as LocationOption[]

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <Link href={`/tournaments/${params.id}`} className="text-brand-muted text-sm">← Back</Link>
      <h1 className="font-heading text-xl font-bold text-brand-dark">Edit Tournament</h1>
      <EditTournamentForm tournament={tournament} locations={locations} />
    </main>
  )
}
