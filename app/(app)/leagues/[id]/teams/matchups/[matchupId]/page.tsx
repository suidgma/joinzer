import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import LineupEditor from './LineupEditor'

// Organizer lineup entry for one team matchup: assign roster players to each line, which
// creates the child (player-vs-player) line fixtures. Team leagues only, organizer-only.
export default async function MatchupPage(props: { params: Promise<{ id: string; matchupId: string }> }) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: league } = await supabase
    .from('leagues').select('id, name, created_by, format_kind, format_settings_json').eq('id', params.id).single()
  if (!league) notFound()
  if ((league as any).format_kind !== 'team') redirect(`/leagues/${params.id}`)

  const { data: myReg } = await supabase
    .from('league_registrations').select('is_co_admin').eq('league_id', params.id).eq('user_id', user.id).maybeSingle()
  const isOrganizer = league.created_by === user.id || (myReg as any)?.is_co_admin === true
  if (!isOrganizer) redirect(`/leagues/${params.id}`)

  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: matchup } = await admin
    .from('league_fixtures')
    .select('id, period_id, round_number, team_1_id, team_2_id, status')
    .eq('id', params.matchupId).eq('league_id', params.id).eq('match_stage', 'team_matchup').maybeSingle()
  if (!matchup) notFound()

  const { data: teamsRaw } = await admin.from('league_teams').select('id, name').in('id', [(matchup as any).team_1_id, (matchup as any).team_2_id])
  const teamName = new Map<string, string>((teamsRaw ?? []).map((t: any) => [t.id, t.name]))

  const { data: membersRaw } = await admin
    .from('league_team_members').select('team_id, registration_id').in('team_id', [(matchup as any).team_1_id, (matchup as any).team_2_id])
  const members = (membersRaw ?? []) as any[]
  const regIds = [...new Set(members.map((m) => m.registration_id))]
  const { data: regsRaw } = regIds.length
    ? await supabase.from('league_registrations').select('id, profile:profiles!user_id(name)').in('id', regIds)
    : { data: [] as any[] }
  const nameByReg = new Map<string, string>((regsRaw ?? []).map((r: any) => [r.id, r.profile?.name ?? 'Player']))
  const rosterOf = (teamId: string) =>
    members.filter((m) => m.team_id === teamId).map((m) => ({ registrationId: m.registration_id, name: nameByReg.get(m.registration_id) ?? 'Player' }))

  const lines = (((league as any).format_settings_json?.lines ?? []) as any[]).map((l, i) => ({
    label: l.label ?? `Line ${i + 1}`,
    discipline: (l.discipline === 'singles' ? 'singles' : 'doubles') as 'singles' | 'doubles',
  }))

  const { data: childrenRaw } = await admin
    .from('league_fixtures')
    .select('match_number, team_1_registration_id, team_1_partner_registration_id, team_2_registration_id, team_2_partner_registration_id')
    .eq('parent_fixture_id', params.matchupId).order('match_number', { ascending: true })
  const children = (childrenRaw ?? []) as any[]
  const initialLineup = lines.map((_, i) => {
    const c = children.find((ch) => ch.match_number === i + 1)
    return c
      ? {
          team1: [c.team_1_registration_id, c.team_1_partner_registration_id].filter(Boolean) as string[],
          team2: [c.team_2_registration_id, c.team_2_partner_registration_id].filter(Boolean) as string[],
        }
      : { team1: [] as string[], team2: [] as string[] }
  })

  const t1Name = teamName.get((matchup as any).team_1_id) ?? 'Team 1'
  const t2Name = teamName.get((matchup as any).team_2_id) ?? 'Team 2'

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
          <Link href={`/leagues/${params.id}/teams`} className="text-brand-muted text-sm">← Teams</Link>
          <span className="text-brand-muted text-sm">/</span>
          <span className="text-sm font-medium text-brand-dark">Matchup</span>
        </div>
      }
      sidebar={<ManageNav items={navItems} />}
    >
      <ManageNav items={navItems} mobileOnly />
      <div className="max-w-2xl space-y-5 pb-8">
        <div>
          <h1 className="font-heading text-xl font-bold text-brand-dark">{t1Name} <span className="text-brand-muted font-normal">vs</span> {t2Name}</h1>
          <p className="text-xs text-brand-muted">Matchday {(matchup as any).round_number} · assign players to each line.</p>
        </div>
        <LineupEditor
          leagueId={params.id}
          matchupId={params.matchupId}
          lines={lines}
          team1={{ name: t1Name, roster: rosterOf((matchup as any).team_1_id) }}
          team2={{ name: t2Name, roster: rosterOf((matchup as any).team_2_id) }}
          initialLineup={initialLineup}
          readOnly={(matchup as any).status === 'completed'}
        />
      </div>
    </DesktopShell>
  )
}
