import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Upload } from 'lucide-react'
import { formatSessionDate, formatTimestamp } from '@/lib/utils/date'
import { formatSkillRange, skillRangeToLevel, formatAgeRange, isSinglesFormat, isDoublesFormat } from '@/lib/taxonomy/formats'
import LeagueActions from './LeagueActions'
import DeleteLeagueButton from './DeleteLeagueButton'
import PlayerCheckIn from '@/components/features/leagues/PlayerCheckIn'
import SubRequestsSection from '@/components/features/leagues/SubRequestsSection'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import { leagueNavItems } from '@/lib/leagues/leagueNav'
import AutoRefresh from '@/components/ui/AutoRefresh'
import RefreshButton from '@/components/ui/RefreshButton'
import { getRunSessionAction } from '@/lib/leagues/runSession'
import LadderPlayerCard from './LadderPlayerCard'
import BoxLadderCheckIn from '@/components/features/leagues/BoxLadderCheckIn'
import RefundPolicyNote from '@/components/features/RefundPolicyNote'
import EarlyBirdNote from '@/components/features/EarlyBirdNote'
import { resolvePriceCents } from '@/lib/payments/priceTiers'
import CaptainRoster from '@/components/features/leagues/CaptainRoster'
import { captainTeamIds, rosteredRegistrationIds } from '@/lib/leagues/teamsServer'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { loadFlexMatches, type FlexMatchView } from '@/lib/leagues/flexView'
import FlexPlayerMatches from './FlexPlayerMatches'
import LeagueSetupChecklist from './LeagueSetupChecklist'
import OrganizerCreatedBanner from '@/components/features/OrganizerCreatedBanner'
import ChatPanel from '@/components/features/ChatPanel'
import PlayerFixtureScores from './PlayerFixtureScores'
import { loadPlayerScorableFixtures, type PlayerScorableFixture } from '@/lib/leagues/playerFixtures'
import PlayerTeamLineScores from './PlayerTeamLineScores'
import { loadPlayerTeamLines, type PlayerTeamLine } from '@/lib/leagues/playerTeamLines'

// Format a DB time string ("HH:MM:SS" or "HH:MM") to "8 AM" / "12 PM" style
function fmtTime(t: string | null): string | null {
  if (!t) return null
  const h = parseInt(t.slice(0, 2))
  const m = parseInt(t.slice(3, 5))
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`
}

// League format (round-robin / box / ladder / team / flex), matching the terms
// used on the create form rather than the packed `format` string.
const FORMAT_KIND_LABELS: Record<string, string> = {
  session_rr: 'Round Robin',
  box:        'Box League',
  ladder:     'Ladder',
  team:       'Team League',
  flex:       'Flex League',
}

const CATEGORY_LABELS: Record<string, string> = {
  mens:   'Men',
  womens: 'Women',
  mixed:  'Mixed',
  coed:   'Coed',
  open:   'Open',
}

// Split the packed `format` (e.g. "mixed_doubles") into its display parts.
function teamTypeLabel(format: string): string | null {
  if (isSinglesFormat(format)) return 'Singles'
  if (isDoublesFormat(format)) return 'Doubles'
  return null // team leagues (custom) have no single team type
}
function categoryLabel(format: string): string | null {
  return CATEGORY_LABELS[format.replace(/_(singles|doubles)$/, '')] ?? null
}


export default async function LeagueDetailPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const params = await props.params;
  const justCreated = (await props.searchParams)?.created === '1';
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: league }, { data: sessions }, { data: myReg }, { data: mySubInterest }, { data: regCounts }, { data: mySessionSubs }, { data: myProfile }, { data: myAttendance }, { data: mySubAssignments }, { data: openSubRequests }, { data: leagueMessages }, { data: waitlistRows }] = await Promise.all([
    supabase
      .from('leagues')
      .select('*, cost_cents, organization:organizations(name), creator:profiles!created_by (name)')
      .eq('id', params.id)
      .single(),
    supabase
      .from('league_sessions')
      .select('id, session_date, session_number, status, notes')
      .eq('league_id', params.id)
      .order('session_date', { ascending: true }),
    user
      ? supabase.from('league_registrations').select('id, status, is_co_admin, registration_type, partner_user_id').eq('league_id', params.id).eq('user_id', user.id).single()
      : Promise.resolve({ data: null }),
    user
      ? supabase.from('league_sub_interest').select('id').eq('league_id', params.id).eq('user_id', user.id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from('league_registrations')
      .select('status, registration_type, partner_user_id')
      .eq('league_id', params.id)
      .neq('status', 'cancelled'),
    user
      ? supabase.from('league_session_subs').select('session_id').eq('user_id', user.id)
      : Promise.resolve({ data: [] }),
    user
      ? supabase.from('profiles').select('gender').eq('id', user.id).single()
      : Promise.resolve({ data: null }),
    // Player self-check-in attendance for this league's sessions
    user
      ? supabase.from('league_session_attendance')
          .select('league_session_id, attendance_status')
          .eq('user_id', user.id)
      : Promise.resolve({ data: [] }),
    // Sessions where this user is formally assigned as a sub
    user
      ? supabase.from('league_session_players')
          .select('id, session_id, player_type')
          .eq('user_id', user.id)
          .eq('player_type', 'sub')
      : Promise.resolve({ data: [] }),
    // Open sub requests in this league (not from current user)
    user
      ? supabase.from('league_sub_requests')
          .select(`
            id, league_id, league_session_id, status, notes,
            requesting_player:profiles!requesting_player_id(name),
            claimed_by:profiles!claimed_by_user_id(name),
            session:league_sessions!league_session_id(session_date, session_number),
            league:leagues!league_id(name)
          `)
          .eq('league_id', params.id)
          .eq('status', 'open')
          .neq('requesting_player_id', user.id)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from('league_messages')
      .select('id, user_id, message_text, created_at, profile:profiles!user_id(name)')
      .eq('league_id', params.id)
      .order('created_at', { ascending: true })
      .limit(100),
    // Unconditional — simplicity over optimization; waitlist sets are small and this avoids ordering complexity in Promise.all
    supabase
      .from('league_registrations')
      .select('user_id, registered_at')
      .eq('league_id', params.id)
      .eq('status', 'waitlist')
      .order('registered_at', { ascending: true })
      .order('id', { ascending: true }),
  ])

  if (!league) notFound()

  // Effective (early-bird-aware) league fee — matches what checkout charges.
  const leagueCostCents = resolvePriceCents((league as any).cost_cents ?? 0, (league as any).price_tiers, new Date())

  const waitlist = (waitlistRows ?? []) as { user_id: string; registered_at: string | null }[]
  const waitlistTotal = waitlist.length
  const idx = user ? waitlist.findIndex(r => r.user_id === user.id) : -1
  const waitlistPosition = idx >= 0 ? idx + 1 : null


  // Fetch partner name if user is a matched solo
  const partnerUserId = (myReg as any)?.partner_user_id ?? null
  let partnerUserName: string | null = null
  if (partnerUserId) {
    const { data: partnerProfile } = await supabase.from('profiles').select('name').eq('id', partnerUserId).single()
    partnerUserName = partnerProfile?.name ?? null
  }

  const isManager = user?.id === league.created_by
  const isCoAdmin = !isManager && myReg?.is_co_admin === true
  const isAdmin = isManager || isCoAdmin
  const attendanceMap = Object.fromEntries(
    (myAttendance ?? []).map((a) => [a.league_session_id as string, a.attendance_status as string])
  )
  const mySubSessionIds = new Set((mySessionSubs ?? []).map((s) => s.session_id as string))

  // Sessions where the user is an assigned sub (from league_session_players)
  const sessionIdSet = new Set((sessions ?? []).map((s) => s.id))

  const assignedSubSessions = (mySubAssignments ?? [])
    .filter((sp) => sessionIdSet.has(sp.session_id as string))
    .map((sp) => (sessions ?? []).find((s) => s.id === sp.session_id))
    .filter(Boolean)
    .filter((s) => s!.status === 'scheduled' || s!.status === 'in_progress')
  const DOUBLES_FORMATS = ['mens_doubles', 'womens_doubles', 'mixed_doubles', 'coed_doubles']
  const isDoublesLeague = DOUBLES_FORMATS.includes(league.format)
  // Fetch pending partner invitation if captain is awaiting response
  let pendingPartnerEmail: string | null = null
  let pendingPartnerExpiresAt: string | null = null
  if (myReg?.status === 'pending_partner' && myReg?.id) {
    const { data: pendingInv } = await supabase
      .from('league_partner_invitations')
      .select('invitee_email, expires_at')
      .eq('captain_registration_id', myReg.id)
      .eq('status', 'pending')
      .maybeSingle()
    pendingPartnerEmail = pendingInv?.invitee_email ?? null
    pendingPartnerExpiresAt = pendingInv?.expires_at ?? null
  }

  // Fetch pending partner invitation for the current user (invitee side).
  // Only runs when user has no active registration — guard against wrong-path solo reg (B14).
  let pendingInvite: { token: string; expiresAt: string } | null = null
  if (user && (!myReg || myReg.status === 'cancelled')) {
    const { data: inviteRows } = await supabase
      .from('league_partner_invitations')
      .select('token, expires_at')
      .eq('league_id', params.id)
      .eq('invitee_user_id', user.id)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .limit(1)
    const inviteRow = inviteRows?.[0] ?? null
    if (inviteRow) {
      pendingInvite = { token: inviteRow.token, expiresAt: inviteRow.expires_at }
    }
  }

  const registeredRegs = regCounts?.filter((r) => r.status === 'registered' || r.status === 'pending_partner') ?? []
  const registeredCount = registeredRegs.filter((r) => r.status === 'registered').length
  const waitlistCount = regCounts?.filter((r) => r.status === 'waitlist').length ?? 0
  const registeredForCapacity = registeredRegs.length
  const isFull = league.max_players != null && registeredForCapacity >= league.max_players

  // For doubles leagues: derive team/solo counts for display
  const soloRegs = isDoublesLeague ? registeredRegs.filter((r) => (r as any).registration_type === 'solo') : []
  const unmatchedSoloCount = soloRegs.filter((r) => !(r as any).partner_user_id).length
  const teamRegsCount = isDoublesLeague ? registeredRegs.filter((r) => (r as any).registration_type === 'team').length : 0
  const effectiveTeams = isDoublesLeague ? teamRegsCount + Math.floor(soloRegs.length / 2) : 0

  const orgName = (league.organization as { name: string } | null)?.name
  const userGender = (myProfile as { gender: string | null } | null)?.gender ?? null

  // Warn if this is a gender-specific format and user hasn't set their gender
  const genderFormats: Record<string, string> = {
    mens_doubles: 'male',
    womens_doubles: 'female',
  }
  const requiredGender = genderFormats[league.format] ?? null
  const genderMismatch = user && requiredGender && userGender !== requiredGender

  const fmt = (d: string | null) =>
    d ? formatSessionDate(d, { weekday: undefined, month: 'long', day: 'numeric', year: 'numeric' }) : null

  // Derive end date from last session so it stays accurate after session edits
  const lastSessionDate = sessions && sessions.length > 0 ? sessions[sessions.length - 1].session_date : null
  const displayEndDate = lastSessionDate ?? league.end_date

  const calStartDate = (league as any).start_date ?? null
  const rawStartTime = (league as any).start_time as string | null
  const rawEndTime = (league as any).estimated_end_time as string | null
  const calendarStart = rawStartTime && calStartDate
    ? `${calStartDate}T${rawStartTime.slice(0, 5)}:00`
    : calStartDate ?? undefined
  const calendarEnd = rawEndTime && calStartDate
    ? `${calStartDate}T${rawEndTime.slice(0, 5)}:00`
    : undefined

  const navItems = leagueNavItems(params.id, { canManage: isAdmin, formatKind: (league as any).format_kind })

  // Poll the page fresh when a session is imminent (today or under way) so
  // attendance, chat, and status stay live in the pre-session window.
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const imminentSession = (sessions ?? []).some(
    (s) => (s.session_date as string) === todayStr || s.status === 'in_progress',
  )

  const runSessionAction = await getRunSessionAction(params.id, isAdmin, (league as any).format_kind)

  // Organizer setup checklist: open registration → add players → start play.
  // "Start play" = any fixtures generated (box/ladder/team/flex) or a session under way (RR).
  let checklist: { regOpen: boolean; hasPlayers: boolean; hasPlay: boolean; runHref: string; runLabel: string } | null = null
  if (isAdmin) {
    const cdb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { count: fixtureCount } = await cdb.from('league_fixtures').select('id', { count: 'exact', head: true }).eq('league_id', params.id)
    const sessionsStarted = (sessions ?? []).some((s: any) => s.status === 'in_progress' || s.status === 'completed')
    checklist = {
      regOpen: (league as any).registration_status === 'open',
      hasPlayers: registeredCount >= 2,
      hasPlay: (fixtureCount ?? 0) > 0 || sessionsStarted,
      runHref: runSessionAction?.href ?? `/leagues/${params.id}/roster`,
      runLabel: runSessionAction?.label ?? 'Run session',
    }
  }

  // Player score entry: a registered player scores their own matches when the league
  // allows it (box/ladder default the toggle on at create; organizers can turn it off).
  // Flex has its own report/confirm flow; RR via the results page.
  let playerFixtures: PlayerScorableFixture[] = []
  let playerTeamLines: PlayerTeamLine[] = []
  if ((league as any).allow_player_scores && user && myReg?.status === 'registered' && !isAdmin) {
    const kind = (league as any).format_kind
    const pfDb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    if (kind === 'box' || kind === 'ladder') {
      playerFixtures = await loadPlayerScorableFixtures(pfDb, league.id, user.id)
    } else if (kind === 'team') {
      playerTeamLines = await loadPlayerTeamLines(pfDb, league.id, user.id)
    }
  }

  // Flex: a registered player's own matches (report / confirm / dispute) on the overview.
  let flexMatches: FlexMatchView[] = []
  if ((league as any).format_kind === 'flex' && user && myReg?.status === 'registered') {
    const flexDb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const res = await loadFlexMatches(flexDb, league.id, league.format, user.id)
    flexMatches = res.matches.filter((m) => m.viewerSide != null)
  }

  // Box / Ladder: a registered player's self-check-in + self-sub for the active
  // cycle/session (unified league_attendance). Deny-all tables → service role.
  let boxLadderCheckIn: {
    periodId: string
    initialStatus: 'coming' | 'present' | 'late' | 'cannot_attend' | null
    allowSelfSub: boolean
    activeSelfSub: { id: string; nomineeName: string } | null
  } | null = null
  {
    const kind = (league as any).format_kind
    if ((kind === 'box' || kind === 'ladder') && user && myReg?.status === 'registered' && !isAdmin) {
      const clDb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
      const { data: period } = await clDb
        .from('league_periods')
        .select('id')
        .eq('league_id', league.id)
        .in('period_kind', ['cycle', 'ladder_session'])
        .eq('status', 'active')
        .order('period_number', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (period) {
        const [{ data: att }, { data: fx }, { data: noms }] = await Promise.all([
          clDb.from('league_attendance').select('status').eq('period_id', period.id).eq('registration_id', myReg.id).maybeSingle(),
          clDb.from('league_fixtures').select('id').eq('period_id', period.id).limit(1),
          clDb.from('sub_nominations').select('id, nominated_user_id').eq('surface', 'league').eq('league_period_id', period.id).eq('requesting_user_id', user.id).eq('status', 'approved').limit(1),
        ])
        const rawStatus = (att as any)?.status as string | undefined
        const initialStatus =
          rawStatus === 'coming' || rawStatus === 'present' || rawStatus === 'late' || rawStatus === 'cannot_attend'
            ? rawStatus
            : null
        let activeSelfSub: { id: string; nomineeName: string } | null = null
        const nomRow = noms?.[0] as any
        if (nomRow) {
          const { data: prof } = await clDb.from('profiles').select('name').eq('id', nomRow.nominated_user_id).maybeSingle()
          activeSelfSub = { id: nomRow.id, nomineeName: (prof as any)?.name ?? 'Your sub' }
        }
        boxLadderCheckIn = { periodId: period.id, initialStatus, allowSelfSub: !(fx && fx.length > 0), activeSelfSub }
      }
    }
  }

  // Team leagues: a team captain gets their team's matchups (lineup + score) and roster
  // self-management right on the overview — the captain-run entry point.
  let captainMatchups: { id: string; oppName: string; status: string; matchday: number | null }[] = []
  let captainTeam: {
    teamId: string
    teamName: string
    members: { id: string; registrationId: string; name: string; isCaptain: boolean }[]
    available: { registrationId: string; name: string }[]
  } | null = null
  if ((league as any).format_kind === 'team' && user && myReg?.status === 'registered' && !isAdmin) {
    const tDb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const caps = await captainTeamIds(tDb, league.id, user.id)
    if (caps.size > 0) {
      const capArr = [...caps]
      const { data: fixtures } = await tDb
        .from('league_fixtures')
        .select('id, round_number, team_1_id, team_2_id, status')
        .eq('league_id', league.id)
        .eq('match_stage', 'team_matchup')
        .or(`team_1_id.in.(${capArr.join(',')}),team_2_id.in.(${capArr.join(',')})`)
        .order('round_number', { ascending: true })
      const fxTeamIds = [...new Set((fixtures ?? []).flatMap((f: any) => [f.team_1_id, f.team_2_id]).filter(Boolean))]
      const { data: fxTeams } = fxTeamIds.length ? await tDb.from('league_teams').select('id, name').in('id', fxTeamIds) : { data: [] as any[] }
      const fxTeamName = new Map<string, string>((fxTeams ?? []).map((t: any) => [t.id, t.name]))
      captainMatchups = (fixtures ?? []).map((f: any) => {
        const oppTeam = caps.has(f.team_1_id) ? f.team_2_id : f.team_1_id
        return { id: f.id, oppName: fxTeamName.get(oppTeam) ?? 'TBD', status: f.status, matchday: f.round_number ?? null }
      })

      // Roster self-management for the captain's team.
      const teamId = capArr[0]
      const [{ data: team }, { data: memberRows }, { data: regRows }] = await Promise.all([
        tDb.from('league_teams').select('id, name, captain_registration_id').eq('id', teamId).maybeSingle(),
        tDb.from('league_team_members').select('id, registration_id').eq('team_id', teamId),
        tDb.from('league_registrations').select('id, user_id').eq('league_id', league.id).eq('status', 'registered'),
      ])
      if (team) {
        const rostered = await rosteredRegistrationIds(tDb, league.id)
        const regUserId = new Map<string, string>((regRows ?? []).map((r: any) => [r.id, r.user_id]))
        const userIds = [...new Set((regRows ?? []).map((r: any) => r.user_id).filter(Boolean))] as string[]
        const { data: profs } = userIds.length ? await tDb.from('profiles').select('id, name').in('id', userIds) : { data: [] as any[] }
        const nameByUser = new Map<string, string>((profs ?? []).map((p: any) => [p.id, p.name]))
        const nameOfReg = (regId: string) => nameByUser.get(regUserId.get(regId) ?? '') ?? 'Player'
        const capReg = (team as any).captain_registration_id
        const members = (memberRows ?? []).map((m: any) => ({ id: m.id, registrationId: m.registration_id, name: nameOfReg(m.registration_id), isCaptain: m.registration_id === capReg }))
        const available = (regRows ?? []).filter((r: any) => !rostered.has(r.id)).map((r: any) => ({ registrationId: r.id, name: nameOfReg(r.id) }))
        captainTeam = { teamId, teamName: (team as any).name, members, available }
      }
    }
  }

  return (
    <DesktopShell
      header={
        <div className="flex items-center gap-3">
          <Link href="/leagues" className="text-brand-muted text-sm">← Leagues</Link>
          <span className="text-brand-muted text-sm">/</span>
          <span className="text-sm font-medium text-brand-dark">{league.name}</span>
        </div>
      }
      sidebar={<ManageNav items={navItems} primaryAction={runSessionAction} />}
    >
      <ManageNav items={navItems} mobileOnly primaryAction={runSessionAction} />
      <AutoRefresh intervalMs={imminentSession ? 20000 : 0} />
      <div className="space-y-4 pb-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-bold text-brand-dark">{league.name}</h1>
          {orgName && <p className="text-sm text-brand-muted">{orgName}</p>}
        </div>
        <RefreshButton className="mt-1 shrink-0" />
      </div>

      {checklist && justCreated && (
        <OrganizerCreatedBanner kind="league" name={league.name} />
      )}

      {checklist && (
        <LeagueSetupChecklist
          leagueId={params.id}
          regOpen={checklist.regOpen}
          hasPlayers={checklist.hasPlayers}
          hasPlay={checklist.hasPlay}
          runHref={checklist.runHref}
          runLabel={checklist.runLabel}
        />
      )}

      {/* Details card */}
      <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
        {(league as any).creator?.name && <Row label="Organizer" value={(league as any).creator.name} />}
        <Row label="League Format" value={FORMAT_KIND_LABELS[(league as any).format_kind ?? 'session_rr'] ?? 'Round Robin'} />
        {teamTypeLabel(league.format) && <Row label="Team Type" value={teamTypeLabel(league.format)!} />}
        {categoryLabel(league.format) && <Row label="Category" value={categoryLabel(league.format)!} />}
        {isDoublesLeague && (
          <Row
            label="Partner Mode"
            value={(league as { partner_mode?: string }).partner_mode === 'fixed'
              ? 'Fixed all season'
              : 'Rotating each round'}
          />
        )}
        {formatSkillRange((league as any).skill_min, (league as any).skill_max) && (
          <Row label="Skill Range" value={formatSkillRange((league as any).skill_min, (league as any).skill_max)!} />
        )}
        {formatAgeRange((league as any).age_min, (league as any).age_max) && (
          <Row label="Age Range" value={formatAgeRange((league as any).age_min, (league as any).age_max)!} />
        )}
        {league.location_name && <Row label="Location" value={league.location_name} />}
        {(rawStartTime || league.schedule_description) && (
          <Row
            label="Times"
            value={
              rawStartTime
                ? [fmtTime(rawStartTime), fmtTime(rawEndTime)].filter(Boolean).join(' – ')
                : league.schedule_description!
            }
          />
        )}
        {fmt(league.start_date) && <Row label="Starts" value={fmt(league.start_date)!} />}
        {fmt(displayEndDate) && <Row label="Ends" value={fmt(displayEndDate)!} />}
        {(league as any).registration_closes_at && (
          <Row label="Reg. closes" value={formatTimestamp((league as any).registration_closes_at) + ' PT'} />
        )}
        {(league as any).no_play_dates?.length > 0 && (
          <Row
            label="No-play dates"
            value={(league as any).no_play_dates.map((d: string) => formatSessionDate(d)).join(', ')}
          />
        )}
        {league.play_days != null && <Row label="Play Days" value={`${league.play_days}`} />}
        <Row
          label="Players"
          value={league.max_players != null
            ? `${registeredForCapacity}/${league.max_players} players${waitlistCount > 0 ? ` · ${waitlistCount} waitlisted` : ''}`
            : `${registeredForCapacity} registered${waitlistCount > 0 ? ` · ${waitlistCount} waitlisted` : ''}`}
        />
      </div>

      {/* Description */}
      {league.description && (
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-4">
          <p className="text-sm text-brand-body whitespace-pre-wrap">{league.description}</p>
        </div>
      )}

      {/* Gender mismatch warning */}
      {genderMismatch && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 text-sm text-yellow-800">
          This league is <strong>{requiredGender === 'male' ? "Men's Doubles" : "Women's Doubles"}</strong>.
          {userGender
            ? ' Your profile gender does not match this format.'
            : ' Please '}
          {!userGender && (
            <Link href="/profile/edit" className="underline font-medium">set your gender in your profile</Link>
          )}
          {!userGender ? ' to register.' : (
            <span> <Link href="/profile/edit" className="underline font-medium">Update your profile</Link> if this is incorrect.</span>
          )}
        </div>
      )}

      {/* Registration actions */}
      {user && (
        <>
          {(league as any).cost_cents > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-2">
              <span className="text-base">💳</span>
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  Registration fee: ${(leagueCostCents / 100).toFixed(0)}/person
                </p>
                <p className="text-xs text-amber-700">Paid securely via Stripe</p>
              </div>
            </div>
          )}
          <EarlyBirdNote baseCents={(league as any).cost_cents ?? 0} tiers={(league as any).price_tiers} />
          <RefundPolicyNote policy={(league as any).refund_policy} noRefundDate={(league as any).no_refund_date} />
          {boxLadderCheckIn && (
            <BoxLadderCheckIn
              leagueId={league.id}
              periodId={boxLadderCheckIn.periodId}
              initialStatus={boxLadderCheckIn.initialStatus}
              allowSelfSub={boxLadderCheckIn.allowSelfSub}
              currentUserId={user?.id}
              activeSelfSub={boxLadderCheckIn.activeSelfSub}
            />
          )}
          {captainMatchups.length > 0 && (
            <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
              <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Your team — matchups</p>
              <p className="text-xs text-brand-muted">Set your lineup and enter scores for your team.</p>
              <div className="divide-y divide-brand-border">
                {captainMatchups.map((m) => (
                  <Link
                    key={m.id}
                    href={`/leagues/${league.id}/teams/matchups/${m.id}`}
                    className="flex items-center justify-between gap-2 py-2.5 hover:bg-brand-soft -mx-1 px-1 rounded-lg transition-colors"
                  >
                    <div className="min-w-0">
                      {m.matchday != null && <p className="text-[10px] text-brand-muted uppercase font-semibold">Matchday {m.matchday}</p>}
                      <p className="text-sm text-brand-dark truncate">vs {m.oppName}</p>
                    </div>
                    <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                      m.status === 'completed' ? 'bg-brand-soft text-brand-muted' : 'bg-brand text-brand-dark'
                    }`}>{m.status === 'completed' ? 'Done' : 'Set lineup'}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {captainTeam && (
            <CaptainRoster
              leagueId={league.id}
              teamId={captainTeam.teamId}
              teamName={captainTeam.teamName}
              members={captainTeam.members}
              available={captainTeam.available}
            />
          )}
          {user && (league as any).format_kind === 'ladder' && myReg?.status === 'registered' && (
            <LadderPlayerCard leagueId={league.id} userId={user.id} format={league.format} settings={(league as any).format_settings_json ?? null} />
          )}
          {flexMatches.length > 0 && (
            <FlexPlayerMatches leagueId={league.id} matches={flexMatches} />
          )}
          <LeagueActions
            leagueId={league.id}
            leagueName={league.name}
            registrationStatus={league.registration_status}
            myReg={(myReg?.status ?? null) as 'registered' | 'waitlist' | 'cancelled' | 'pending_partner' | null}
            mySubInterest={!!mySubInterest}
            isFull={isFull}
            costCents={leagueCostCents}
            format={league.format}
            partnerMode={(league as any).partner_mode ?? null}
            partnerUserName={partnerUserName}
            pendingPartnerEmail={pendingPartnerEmail}
            pendingPartnerExpiresAt={pendingPartnerExpiresAt}
            pendingInvite={pendingInvite}
            sessions={sessions ?? []}
            mySubSessionIds={Array.from(mySubSessionIds)}
            waitlistPosition={waitlistPosition}
            waitlistTotal={waitlistTotal}
            calendarStart={calendarStart}
            calendarEnd={calendarEnd}
            calendarTimezone="America/Los_Angeles"
            calendarLocation={(league as any).location_name ?? undefined}
          />
        </>
      )}
      {!user && (
        <p className="text-sm text-brand-muted text-center">
          <Link href="/login" className="text-brand-active underline">Sign in</Link> to register or express sub interest.
        </p>
      )}

      {/* Sub assignments — sessions where user is formally assigned as a sub */}
      {user && assignedSubSessions.length > 0 && (
        <section className="space-y-2">
          <div className="bg-yellow-50 border border-yellow-300 rounded-2xl p-4 space-y-3">
            <div>
              <p className="text-sm font-bold text-yellow-900">You&apos;re subbing in this league</p>
              <p className="text-xs text-yellow-700 mt-0.5">Let the organizer know if you&apos;re coming.</p>
            </div>
            {assignedSubSessions.map((s) => {
              const myStatus = (attendanceMap[s!.id] ?? 'not_responded') as
                'planning_to_attend' | 'cannot_attend' | 'checked_in_present' | 'running_late' | 'not_responded'
              return (
                <div key={s!.id} className="space-y-2">
                  <p className="text-sm font-semibold text-yellow-900">
                    Session {s!.session_number} — {formatSessionDate(s!.session_date)}
                  </p>
                  <PlayerCheckIn
                    sessionId={s!.id}
                    leagueId={league.id}
                    initialStatus={myStatus}
                    showSubRequest={false}
                    leagueSkillLevel={skillRangeToLevel((league as any).skill_min, (league as any).skill_max)}
                  />
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Your matches to score — box/ladder player self-scoring, surfaced up top */}
      {playerFixtures.length > 0 && (
        <PlayerFixtureScores leagueId={league.id} fixtures={playerFixtures} pointsToWin={(league as any).points_to_win ?? 11} />
      )}

      {/* Standings quick link */}
      <Link
        href={`/leagues/${league.id}/standings`}
        className="flex items-center justify-between bg-brand-surface border border-brand-border rounded-2xl px-4 py-3 hover:bg-brand-soft transition-colors"
      >
        <p className="text-sm font-semibold text-brand-dark">Standings/Results</p>
        <span className="text-brand-active text-sm">→</span>
      </Link>

      {/* League chat — members only (matches the message RLS), inline preview, expands in place */}
      {user && (isAdmin || (myReg && myReg.status !== 'cancelled')) && (
        <ChatPanel
          table="league_messages"
          entityField="league_id"
          entityId={league.id}
          initialMessages={(leagueMessages ?? []) as any[]}
          currentUserId={user.id}
          canChat={isAdmin || myReg?.status === 'registered'}
          title="League Chat"
          joinHint="Join to chat"
        />
      )}

      {/* Player score entry — own team lines when the league allows it */}
      {playerTeamLines.length > 0 && (
        <PlayerTeamLineScores leagueId={league.id} lines={playerTeamLines} pointsToWin={(league as any).points_to_win ?? 11} />
      )}

      {/* Organizer: bulk-import players via CSV */}
      {isAdmin && (
        <Link
          href={`/leagues/${league.id}/import`}
          className="flex items-center justify-between gap-2 bg-brand-surface border border-brand-border rounded-2xl px-4 py-3 hover:border-brand-active transition-colors"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-brand-dark">
            <Upload size={16} className="text-brand-active" />
            Import players
          </span>
          <span className="text-sm text-brand-muted">CSV →</span>
        </Link>
      )}

      {/* Open sub requests for registered players */}
      {user && myReg?.status === 'registered' && (openSubRequests ?? []).length > 0 && (
        <SubRequestsSection
          initialRequests={(openSubRequests ?? []) as any[]}
          currentUserId={user.id}
        />
      )}

      {/* Admin view */}
      {isAdmin && (
        <section className="space-y-2">
          {sessions && sessions.length > 0 && (
            <>
              <h2 className="font-heading text-base font-bold text-brand-dark">Schedule</h2>
              <div className="space-y-2">
                {sessions.map((s) => (
                  <div key={s.id} className="bg-brand-surface border border-brand-border rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-brand-dark">
                        Session {s.session_number} — {formatSessionDate(s.session_date)}
                      </p>
                      {s.notes && <p className="text-xs text-brand-muted truncate">{s.notes}</p>}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                        s.status === 'completed' ? 'bg-brand-soft text-brand-muted' :
                        s.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                        s.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                        'bg-brand text-brand-dark'
                      }`}>{s.status.replace('_', ' ')}</span>
                      <Link
                        href={`/leagues/${league.id}/sessions/${s.id}/live`}
                        className="text-sm text-brand-active underline underline-offset-2 whitespace-nowrap"
                      >
                        Manage →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          <h2 className="font-heading text-base font-bold text-brand-dark">Court Monitor</h2>
          <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
            <p className="text-sm text-brand-body">{registeredCount} registered · {waitlistCount} waitlisted</p>
            {isManager && (
              <div className="pt-2 border-t border-brand-border">
                <DeleteLeagueButton leagueId={league.id} />
              </div>
            )}
          </div>
        </section>
      )}

      </div>
    </DesktopShell>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-xs text-brand-muted w-28 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-brand-dark">{value}</span>
    </div>
  )
}
