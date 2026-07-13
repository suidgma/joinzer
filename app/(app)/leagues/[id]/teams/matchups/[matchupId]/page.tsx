import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import LineupEditor from './LineupEditor'
import MatchupScorer from './MatchupScorer'
import { teamMatchupRole } from '@/lib/leagues/teamsServer'

// Match-day surface for one team matchup: set the lineup + score. The organizer runs both
// sides; a team captain runs only their own side. Team leagues only.
export default async function MatchupPage(props: { params: Promise<{ id: string; matchupId: string }> }) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: league } = await supabase
    .from('leagues').select('id, name, created_by, format_kind, format_settings_json').eq('id', params.id).single()
  if (!league) notFound()
  if ((league as any).format_kind !== 'team') redirect(`/leagues/${params.id}`)

  const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: matchup } = await admin
    .from('league_fixtures')
    .select('id, period_id, round_number, team_1_id, team_2_id, team_1_score, team_2_score, winner_team_id, status')
    .eq('id', params.matchupId).eq('league_id', params.id).eq('match_stage', 'team_matchup').maybeSingle()
  if (!matchup) notFound()

  // Organizer runs both sides; a team captain runs only their own side.
  const role = await teamMatchupRole(admin, params.id, user.id, (matchup as any).team_1_id, (matchup as any).team_2_id)
  if (!role.isOrganizer && role.captainSide === null) redirect(`/leagues/${params.id}`)
  const viewerSide: 1 | 2 | undefined = role.isOrganizer ? undefined : role.captainSide ?? undefined

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
    .select('id, match_number, team_1_registration_id, team_1_partner_registration_id, team_2_registration_id, team_2_partner_registration_id, team_1_score, team_2_score, status')
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

  const namesOf = (ids: (string | null)[]) => ids.filter(Boolean).map((r) => nameByReg.get(r as string) ?? 'Player')
  const scoreLines = lines
    .map((line, i) => {
      const c = children.find((ch) => ch.match_number === i + 1)
      if (!c) return null
      return {
        id: c.id as string,
        label: line.label,
        discipline: line.discipline,
        team1Players: namesOf([c.team_1_registration_id, c.team_1_partner_registration_id]),
        team2Players: namesOf([c.team_2_registration_id, c.team_2_partner_registration_id]),
        team1Score: (c.team_1_score ?? null) as number | null,
        team2Score: (c.team_2_score ?? null) as number | null,
        status: (c.status ?? 'scheduled') as string,
      }
    })
    .filter(Boolean) as {
      id: string; label: string; discipline: 'singles' | 'doubles'
      team1Players: string[]; team2Players: string[]
      team1Score: number | null; team2Score: number | null; status: string
    }[]
  const hasLineup = children.length > 0

  const t1Name = teamName.get((matchup as any).team_1_id) ?? 'Team 1'
  const t2Name = teamName.get((matchup as any).team_2_id) ?? 'Team 2'
  const winnerName = (matchup as any).winner_team_id
    ? teamName.get((matchup as any).winner_team_id) ?? null
    : null

  const navItems: ManageNavItem[] = role.isOrganizer
    ? [
        { label: 'Overview', href: `/leagues/${params.id}` },
        { label: 'Standings', href: `/leagues/${params.id}/standings` },
        { label: 'Teams', href: `/leagues/${params.id}/teams` },
        { label: 'Roster', href: `/leagues/${params.id}/roster` },
        { label: 'Edit', href: `/leagues/${params.id}/edit` },
      ]
    : [
        { label: 'Overview', href: `/leagues/${params.id}` },
        { label: 'Standings', href: `/leagues/${params.id}/standings` },
      ]
  const backHref = role.isOrganizer ? `/leagues/${params.id}/teams` : `/leagues/${params.id}`
  const backLabel = role.isOrganizer ? 'Teams' : league.name

  return (
    <DesktopShell
      header={
        <div className="flex items-center gap-3">
          <Link href={backHref} className="text-brand-muted text-sm">← {backLabel}</Link>
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
          <p className="text-xs text-brand-muted">
            Matchday {(matchup as any).round_number}
            {(matchup as any).status === 'completed' && (
              <> · <span className="font-semibold text-brand-dark">{(matchup as any).team_1_score}–{(matchup as any).team_2_score}</span>{winnerName ? ` · ${winnerName} won` : ' · tie'}</>
            )}
          </p>
        </div>

        {hasLineup && (
          <MatchupScorer
            leagueId={params.id}
            matchupId={params.matchupId}
            team1Name={t1Name}
            team2Name={t2Name}
            lines={scoreLines}
          />
        )}

        <details open={!hasLineup} className="group">
          <summary className="cursor-pointer text-sm font-semibold text-brand-dark list-none flex items-center gap-1">
            <span className="text-brand-muted transition-transform group-open:rotate-90">▸</span>
            {hasLineup ? 'Edit lineup' : 'Set lineup'}
          </summary>
          <div className="pt-3">
            {hasLineup && (matchup as any).status !== 'completed' && (
              <p className="text-xs text-brand-muted pb-2">Changing the lineup clears any line scores for this matchup.</p>
            )}
            <LineupEditor
              leagueId={params.id}
              matchupId={params.matchupId}
              lines={lines}
              team1={{ name: t1Name, roster: rosterOf((matchup as any).team_1_id) }}
              team2={{ name: t2Name, roster: rosterOf((matchup as any).team_2_id) }}
              initialLineup={initialLineup}
              readOnly={(matchup as any).status === 'completed'}
              side={viewerSide}
            />
          </div>
        </details>
      </div>
    </DesktopShell>
  )
}
