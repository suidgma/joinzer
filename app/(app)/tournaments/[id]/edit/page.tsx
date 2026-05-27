import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import EditTournamentForm from '@/components/features/tournaments/EditTournamentForm'
import type { TournamentDetail, LocationOption } from '@/lib/types'

export default async function EditTournamentPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: tournamentData }, { data: locationData }] = await Promise.all([
    supabase
      .from('tournaments')
      .select(`
        id, name, description, start_date, start_time, estimated_end_time,
        status, visibility, registration_status, registration_closes_at, organizer_id, cost_cents,
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
      <Link
        href={`/tournaments/${params.id}/staff`}
        className="block bg-white rounded-xl border border-brand-border p-4 hover:border-brand-active transition-colors"
      >
        <p className="text-sm font-semibold text-brand-dark">Staff &amp; volunteers →</p>
        <p className="text-xs text-brand-muted mt-1">
          Invite co-organizers and volunteers to help manage the event.
        </p>
      </Link>
      <Link
        href={`/tournaments/${params.id}/import`}
        className="block bg-white rounded-xl border border-brand-border p-4 hover:border-brand-active transition-colors"
      >
        <p className="text-sm font-semibold text-brand-dark">Import teams from CSV →</p>
        <p className="text-xs text-brand-muted mt-1">
          Bulk-add registered teams from a spreadsheet.
        </p>
      </Link>
    </main>
  )
}
