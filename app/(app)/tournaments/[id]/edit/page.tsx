import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import EditTournamentForm from '@/components/features/tournaments/EditTournamentForm'
import DesktopShell from '@/components/ui/desktop-shell'
import WizardOutline from '@/components/ui/wizard-outline'
import type { TournamentDetail, LocationOption } from '@/lib/types'
import type { WizardStep } from '@/components/ui/wizard-outline'

const STEPS: WizardStep[] = [
  { id: 'basics',       label: 'Basics',                  status: 'current'  },
  { id: 'schedule',     label: 'Schedule',                status: 'upcoming' },
  { id: 'registration', label: 'Registration',            status: 'upcoming' },
  { id: 'visibility',   label: 'Visibility & Publishing', status: 'upcoming' },
]

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
    <DesktopShell
      header={
        <div className="flex items-center gap-3">
          <Link href={`/tournaments/${params.id}`} className="text-brand-muted text-sm">← Back</Link>
          <span className="text-brand-muted text-sm">/</span>
          <span className="text-sm font-medium text-brand-dark">Edit Tournament</span>
        </div>
      }
      rail={<WizardOutline steps={STEPS} title="Edit Tournament" />}
    >
      <EditTournamentForm tournament={tournament} locations={locations} />
    </DesktopShell>
  )
}
