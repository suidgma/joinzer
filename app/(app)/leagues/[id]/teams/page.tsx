import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import RefreshButton from '@/components/ui/RefreshButton'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import TeamsManager from './TeamsManager'
import TeamSchedule from './TeamSchedule'

// Organizer team management for Team Leagues (Phase 1 Step 1). Create teams and assign
// registered players; set a captain per team. league_teams / league_team_members are RLS
// deny-all, so reads here use the service role. Organizer-only.
export default async function LeagueTeamsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: league } = await supabase
    .from('leagues').select('id, name, created_by, format_kind').eq('id', params.id).single()
  if (!league) notFound()
  if ((league as any).format_kind !== 'team') redirect(`/leagues/${params.id}`)

  const { data: myReg } = await supabase
    .from('league_registrations').select('is_co_admin').eq('league_id', params.id).eq('user_id', user.id).maybeSingle()
  const isOrganizer = league.created_by === user.id || (myReg as any)?.is_co_admin === true
  if (!isOrganizer) redirect(`/leagues/${params.id}`)

  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: regsRaw } = await supabase
    .from('league_registrations')
    .select('id, user_id, profile:profiles!user_id(name)')
    .eq('league_id', params.id).eq('status', 'registered')
    .order('registered_at', { ascending: true })
  const regs = (regsRaw ?? []) as any[]
  const nameByReg = new Map<string, string>(regs.map((r) => [r.id, r.profile?.name ?? 'Player']))

  const { data: teamsRaw } = await admin
    .from('league_teams').select('id, name, captain_registration_id, status')
    .eq('league_id', params.id).order('created_at', { ascending: true })
  const teams = (teamsRaw ?? []) as any[]
  const teamIds = teams.map((t) => t.id)
  const { data: membersRaw } = teamIds.length
    ? await admin.from('league_team_members').select('id, team_id, registration_id, role').in('team_id', teamIds)
    : { data: [] as any[] }
  const members = (membersRaw ?? []) as any[]

  const rosteredRegIds = new Set(members.map((m) => m.registration_id))
  const availablePlayers = regs
    .filter((r) => !rosteredRegIds.has(r.id))
    .map((r) => ({ registrationId: r.id, name: r.profile?.name ?? 'Player' }))

  const teamViews = teams.map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    captainRegistrationId: t.captain_registration_id,
    members: members
      .filter((m) => m.team_id === t.id)
      .map((m) => ({
        id: m.id,
        registrationId: m.registration_id,
        name: nameByReg.get(m.registration_id) ?? 'Player',
        isCaptain: m.registration_id === t.captain_registration_id,
      })),
  }))

  // Schedule: matchday periods + parent (team-vs-team) fixtures.
  const teamNameById = new Map<string, string>(teams.map((t) => [t.id, t.name]))
  const { data: periodsRaw } = await admin
    .from('league_periods').select('id, period_number, name')
    .eq('league_id', params.id).eq('period_kind', 'matchday').order('period_number', { ascending: true })
  const periods = (periodsRaw ?? []) as any[]
  const { data: matchupsRaw } = periods.length
    ? await admin.from('league_fixtures')
        .select('id, period_id, round_number, team_1_id, team_2_id, status')
        .eq('league_id', params.id).eq('match_stage', 'team_matchup')
        .order('round_number', { ascending: true }).order('match_number', { ascending: true })
    : { data: [] as any[] }
  const matchups = (matchupsRaw ?? []) as any[]
  const scheduleView = periods.map((p) => ({
    round: p.period_number as number,
    name: (p.name as string) ?? `Matchday ${p.period_number}`,
    matchups: matchups
      .filter((m) => m.period_id === p.id)
      .map((m) => ({
        id: m.id as string,
        team1: teamNameById.get(m.team_1_id) ?? 'Team',
        team2: teamNameById.get(m.team_2_id) ?? 'Team',
        status: m.status as string,
      })),
  }))

  const navItems: ManageNavItem[] = [
    { label: 'Overview', href: `/leagues/${params.id}` },
    { label: 'Standings', href: `/leagues/${params.id}/standings` },
    { label: 'Teams', href: `/leagues/${params.id}/teams` },
    { label: 'Roster', href: `/leagues/${params.id}/roster` },
    { label: 'Edit', href: `/leagues/${params.id}/edit` },
  ]

  return (
    <DesktopShell
      header={
        <div className="flex items-center gap-3">
          <Link href={`/leagues/${params.id}`} className="text-brand-muted text-sm">← {league.name}</Link>
          <span className="text-brand-muted text-sm">/</span>
          <span className="text-sm font-medium text-brand-dark">Teams</span>
        </div>
      }
      sidebar={<ManageNav items={navItems} />}
    >
      <ManageNav items={navItems} mobileOnly />
      <div className="max-w-2xl space-y-5 pb-8">
        <div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-heading text-xl font-bold text-brand-dark">Teams</h1>
            <RefreshButton className="mt-1 shrink-0" />
          </div>
          <p className="text-xs text-brand-muted">Create teams and assign registered players. Set a captain per team.</p>
        </div>
        <TeamsManager leagueId={params.id} initialTeams={teamViews} availablePlayers={availablePlayers} />
        <TeamSchedule leagueId={params.id} schedule={scheduleView} teamCount={teams.filter((t) => t.status !== 'withdrawn').length} />
      </div>
    </DesktopShell>
  )
}
