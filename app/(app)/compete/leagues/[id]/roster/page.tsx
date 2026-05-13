import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import LeagueRosterManager from './LeagueRosterManager'

export default async function LeagueRosterPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: league } = await supabase
    .from('leagues')
    .select('id, name, created_by, max_players')
    .eq('id', params.id)
    .single()

  if (!league) notFound()

  // Co-admins can access roster too
  const { data: myReg } = await supabase
    .from('league_registrations')
    .select('is_co_admin')
    .eq('league_id', params.id)
    .eq('user_id', user.id)
    .single()
  const isCoAdmin = myReg?.is_co_admin === true
  if (league.created_by !== user.id && !isCoAdmin) redirect(`/compete/leagues/${params.id}`)

  const [{ data: registrations }, { data: subInterest }, { data: sessions }, { data: allProfiles }] =
    await Promise.all([
      supabase
        .from('league_registrations')
        .select('status, registered_at, is_co_admin, user_id, profile:profiles(id, name, profile_photo_url, dupr_rating, estimated_rating, rating_source)')
        .eq('league_id', params.id)
        .neq('status', 'cancelled')
        .order('registered_at', { ascending: true }),
      supabase
        .from('league_sub_interest')
        .select('created_at, profile:profiles(id, name, profile_photo_url)')
        .eq('league_id', params.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('league_sessions')
        .select('id, session_number, session_date, league_session_subs(user_id, profile:profiles(id, name))')
        .eq('league_id', params.id)
        .order('session_date', { ascending: true }),
      // Fetch all profiles then exclude registered ones — Supabase JS client doesn't support subqueries
      supabase.from('profiles').select('id, name').order('name', { ascending: true }).limit(200),
    ])

  // Exclude anyone already in the roster (non-cancelled)
  const registeredUserIds = new Set(
    (registrations ?? []).map((r) => (r.profile as unknown as { id: string }).id)
  )
  const availablePlayers = (allProfiles ?? []).filter((p) => !registeredUserIds.has(p.id))

  const registered = (registrations ?? []).filter((r) => r.status === 'registered') as any[]
  const waitlisted = (registrations ?? []).filter((r) => r.status === 'waitlist') as any[]

  return (
    <LeagueRosterManager
      leagueId={params.id}
      leagueName={league.name}
      maxPlayers={league.max_players ?? null}
      registered={registered}
      waitlisted={waitlisted}
      subInterest={(subInterest ?? []) as any[]}
      sessions={(sessions ?? []) as any[]}
      availablePlayers={availablePlayers}
      isPrimaryOrganizer={league.created_by === user.id}
    />
  )
}
