import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import TournamentRosterManager from './TournamentRosterManager'

export default async function TournamentRosterPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name, created_by')
    .eq('id', params.id)
    .single()

  if (!tournament) notFound()
  if (tournament.created_by !== user.id) redirect(`/compete/tournaments/${params.id}`)

  const { data: events } = await supabase
    .from('tournament_events')
    .select('id, name, category, skill_level, max_teams')
    .eq('tournament_id', params.id)
    .order('category')

  const eventIds = (events ?? []).map((e) => e.id)

  const [{ data: registrations }, { data: allProfiles }] = await Promise.all([
    eventIds.length > 0
      ? supabase
          .from('tournament_registrations')
          .select('tournament_event_id, status, partner_name, registered_at, profile:profiles(id, name, profile_photo_url)')
          .in('tournament_event_id', eventIds)
          .neq('status', 'cancelled')
          .order('registered_at', { ascending: true })
      : Promise.resolve({ data: [] }),
    supabase.from('profiles').select('id, name').order('name', { ascending: true }).limit(200),
  ])

  // Group registrations by event
  type Reg = { tournament_event_id: string; status: string; partner_name: string | null; registered_at: string; profile: { id: string; name: string; profile_photo_url: string | null }[] }
  const regsByEvent: Record<string, Reg[]> = {}
  for (const reg of (registrations ?? []) as unknown as Reg[]) {
    if (!regsByEvent[reg.tournament_event_id]) regsByEvent[reg.tournament_event_id] = []
    regsByEvent[reg.tournament_event_id]!.push(reg)
  }

  // Exclude profiles already registered in any event of this tournament
  const registeredUserIds = new Set(
    (registrations ?? []).map((r) => (r.profile as unknown as { id: string }).id)
  )
  const availablePlayers = (allProfiles ?? []).filter((p) => !registeredUserIds.has(p.id))

  return (
    <TournamentRosterManager
      tournamentId={params.id}
      tournamentName={tournament.name}
      events={events ?? []}
      regsByEvent={regsByEvent as any}
      availablePlayers={availablePlayers}
    />
  )
}
