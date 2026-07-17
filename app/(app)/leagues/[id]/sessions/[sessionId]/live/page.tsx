import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import LiveSessionManager from './LiveSessionManager'
import { selfReportToActualStatus } from '@/lib/leagues/attendance'
import ClaimHostButton from './ClaimHostButton'
import HostControls from './HostControls'
import RefreshButton from '@/components/ui/RefreshButton'
import RealtimeRefresh from '@/components/ui/RealtimeRefresh'
import { sessionHostTopic, RealtimeEvents } from '@/lib/realtime/topics'
import { formatSessionDate } from '@/lib/utils/date'

export default async function LiveSessionPage(
  props: {
    params: Promise<{ id: string; sessionId: string }>
  }
) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [{ data: league }, { data: session }] = await Promise.all([
    db.from('leagues').select('id, name, created_by, format, partner_mode, self_run, season_host_user_id').eq('id', params.id).single(),
    db.from('league_sessions').select('id, session_number, session_date, status, number_of_courts, rounds_planned, host_user_id').eq('id', params.sessionId).single(),
  ])

  if (!league || !session) notFound()

  const dateStr = formatSessionDate(session.session_date, { weekday: 'long', month: 'long', day: 'numeric' })

  // --- Host context (player-run leagues) ---
  const selfRun = !!(league as any).self_run
  const effectiveHostId = (session as any).host_user_id ?? (league as any).season_host_user_id ?? null
  const isOwner = league.created_by === user.id

  const { data: regRow } = await db
    .from('league_registrations')
    .select('is_co_admin')
    .eq('league_id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()
  const isCoAdmin = !!(regRow as { is_co_admin?: boolean } | null)?.is_co_admin
  const isRosterMember = !!regRow

  const canOperate = isOwner || isCoAdmin || (selfRun && !!effectiveHostId && effectiveHostId === user.id)

  if (!canOperate) {
    // A roster member of a player-run league who isn't operating sees a HostGate:
    // claim the empty seat, or a "who's hosting" screen when it's taken.
    if (selfRun && isRosterMember) {
      let hostName: string | null = null
      if (effectiveHostId) {
        const { data: hostProfile } = await db
          .from('profiles')
          .select('name')
          .eq('id', effectiveHostId)
          .maybeSingle()
        hostName = (hostProfile as { name?: string } | null)?.name ?? 'Someone'
      }
      return (
        <main className="max-w-lg mx-auto p-4 space-y-4">
          <RealtimeRefresh topic={sessionHostTopic(params.sessionId)} events={[RealtimeEvents.sessionHostChanged]} />
          <div className="flex items-center justify-between gap-2">
            <Link href={`/leagues/${params.id}`} className="text-brand-muted text-sm">← Back</Link>
            <RefreshButton />
          </div>

          <div>
            <h1 className="font-heading text-xl font-bold text-brand-dark">League Play Manager</h1>
            <p className="text-sm text-brand-muted">{league.name} · Session {session.session_number} · {dateStr}</p>
          </div>

          {effectiveHostId ? (
            <div className="rounded-xl border border-brand-border bg-brand-surface p-4 space-y-2">
              <p className="text-brand-dark font-medium">🎾 {hostName} is hosting tonight&apos;s session.</p>
              <p className="text-sm text-brand-muted">You&apos;ll be able to see live scores on the league page.</p>
              <Link href={`/leagues/${params.id}`} className="inline-block text-sm font-semibold text-brand-active">← Back to league</Link>
            </div>
          ) : (
            <div className="rounded-xl border border-brand-border bg-brand-surface p-4 space-y-3">
              <p className="text-brand-dark">No one is hosting yet — start the session for everyone.</p>
              <ClaimHostButton sessionId={params.sessionId} leagueId={params.id} meId={user.id} />
            </div>
          )}
        </main>
      )
    }
    redirect(`/leagues/${params.id}`)
  }

  // --- Sync session players: seed missing roster players on every load ---
  const [
    { data: existingSessionPlayers },
    { data: existingAttendance },
    { data: registrations },
    { data: sessionSubs },
    { count: completedRoundCount },
  ] = await Promise.all([
    db.from('league_session_players').select('user_id, id, player_type').eq('session_id', params.sessionId),
    db.from('league_session_attendance').select('user_id, attendance_status').eq('league_session_id', params.sessionId),
    db.from('league_registrations')
      .select('user_id, partner_user_id, profile:profiles!user_id(id, name, joinzer_rating, dupr_rating, estimated_rating)')
      .eq('league_id', params.id)
      .eq('status', 'registered'),
    db.from('league_session_subs')
      .select('user_id, profile:profiles(id, name, joinzer_rating)')
      .eq('session_id', params.sessionId),
    db.from('league_rounds')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', params.sessionId)
      .eq('status', 'completed'),
  ])

  const seededUserIds = new Set((existingSessionPlayers ?? []).map(p => p.user_id as string))

  const selfStatusMap: Record<string, string> = {}
  for (const a of existingAttendance ?? []) {
    selfStatusMap[a.user_id as string] = a.attendance_status as string
  }

  const resolveActualStatus = (userId: string): string => selfReportToActualStatus(selfStatusMap[userId])

  // Insert any registered players not yet in session players
  const newRosterRows = (registrations ?? [])
    .filter((r: Record<string, unknown>) => !seededUserIds.has(r.user_id as string))
    .map((r: Record<string, unknown>) => {
      const profile = r.profile as Record<string, unknown>
      return {
        session_id:       params.sessionId,
        user_id:          r.user_id,
        display_name:     profile?.name ?? 'Unknown',
        player_type:      'roster_player',
        expected_status:  'expected',
        actual_status:    resolveActualStatus(r.user_id as string),
        joinzer_rating:   profile?.joinzer_rating ?? 1000,
        dupr_rating:      profile?.dupr_rating ?? null,
        estimated_rating: profile?.estimated_rating ?? null,
      }
    })
  if (newRosterRows.length > 0) {
    await db.from('league_session_players').insert(newRosterRows)
  }

  // Insert any session subs not yet in session players
  const newSubRows = (sessionSubs ?? [])
    .filter((s: Record<string, unknown>) => !seededUserIds.has(s.user_id as string))
    .map((s: Record<string, unknown>) => {
      const profile = s.profile as Record<string, unknown>
      return {
        session_id:      params.sessionId,
        user_id:         s.user_id,
        display_name:    profile?.name ?? 'Sub',
        player_type:     'sub',
        expected_status: 'expected',
        actual_status:   resolveActualStatus(s.user_id as string),
        joinzer_rating:  profile?.joinzer_rating ?? 1000,
      }
    })
  if (newSubRows.length > 0) {
    await db.from('league_session_players').insert(newSubRows)
  }

  // Remove stale roster_players whose registration has since been cancelled.
  // Only safe before any round is completed — after that, removing a player breaks match history.
  if ((completedRoundCount ?? 0) === 0) {
    const registeredUserIds = new Set((registrations ?? []).map(r => r.user_id as string))
    const staleIds = (existingSessionPlayers ?? [])
      .filter(p => (p as any).player_type === 'roster_player' && !registeredUserIds.has(p.user_id as string))
      .map(p => p.id)
    if (staleIds.length > 0) {
      await db.from('league_session_players').delete().in('id', staleIds)
    }
  }

  // Before any rounds are completed, re-sync existing players' statuses from self-reports.
  // This corrects stale defaults (e.g. 'present') set by older code before the session starts.
  if ((completedRoundCount ?? 0) === 0 && (existingSessionPlayers ?? []).length > 0) {
    const updates = (existingSessionPlayers ?? [])
      .map(p => ({ id: p.id, actual_status: resolveActualStatus((p.user_id as string) ?? '') }))
    await Promise.all(
      updates.map(u =>
        db.from('league_session_players').update({ actual_status: u.actual_status }).eq('id', u.id)
      )
    )
  }

  // --- Fetch current session players ---
  const { data: players } = await db
    .from('league_session_players')
    .select('*')
    .eq('session_id', params.sessionId)
    .order('player_type')
    .order('display_name')

  // --- Fetch active sub requests for this session (open + filled) ---
  const { data: subRequests } = await db
    .from('league_sub_requests')
    .select(`
      id, status, fulfillment_mode, requesting_player_id,
      requesting_player:profiles!requesting_player_id(name),
      filled_by:profiles!filled_by_user_id(name)
    `)
    .eq('league_session_id', params.sessionId)
    .in('status', ['open', 'filled'])

  // --- Fetch profiles not already in this session (for Add Sub dropdown) ---
  const existingUserIds = (players ?? []).map(p => p.user_id).filter(Boolean) as string[]
  const profileQuery = db.from('profiles').select('id, name').order('name')
  const { data: availableProfiles } = existingUserIds.length > 0
    ? await profileQuery.not('id', 'in', `(${existingUserIds.join(',')})`)
    : await profileQuery

  // --- Fetch rounds with their matches ---
  const { data: rounds } = await db
    .from('league_rounds')
    .select('*, matches:league_round_matches(*)')
    .eq('session_id', params.sessionId)
    .order('round_number')

  // --- Fetch entered match scores ---
  const { data: matchScoreRows } = await db
    .from('league_matches')
    .select('round_number, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, team1_score, team2_score')
    .eq('session_id', params.sessionId)
    .not('team1_score', 'is', null)

  const scoredRoundNumbers = Array.from(new Set((matchScoreRows ?? []).map(r => r.round_number as number)))

  // Build userId → teamName map for fixed-partner leagues
  const teamByUserId: Record<string, string> = {}
  if ((league as any).partner_mode === 'fixed') {
    const seen = new Set<string>()
    const regList = (registrations ?? []) as any[]
    const nameByUserId = Object.fromEntries(regList.map((r: any) => [r.user_id, r.profile?.name ?? '']))
    for (const reg of regList) {
      if (!reg.partner_user_id) continue
      const canonical = reg.user_id < reg.partner_user_id
        ? `${reg.user_id}|${reg.partner_user_id}`
        : `${reg.partner_user_id}|${reg.user_id}`
      if (seen.has(canonical)) continue
      seen.add(canonical)
      const n1 = (nameByUserId[reg.user_id] ?? '').split(' ')[0]
      const n2 = (nameByUserId[reg.partner_user_id] ?? '').split(' ')[0]
      const [first, second] = n1.localeCompare(n2) <= 0 ? [n1, n2] : [n2, n1]
      const teamName = `Team ${first}/${second}`
      teamByUserId[reg.user_id] = teamName
      teamByUserId[reg.partner_user_id] = teamName
    }
  }

  // Present players eligible to receive the host role (self-run only): exclude rows
  // without a user_id and the current effective host.
  const presentPlayers = selfRun
    ? (players ?? [])
        .filter((p: any) => p.actual_status === 'present' && p.user_id && p.user_id !== effectiveHostId)
        .map((p: any) => ({ id: p.user_id as string, name: (p.display_name as string) ?? 'Player' }))
    : []
  const currentHostName = effectiveHostId
    ? ((players ?? []).find((p: any) => p.user_id === effectiveHostId)?.display_name ?? null)
    : null

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      {selfRun && <RealtimeRefresh topic={sessionHostTopic(params.sessionId)} events={[RealtimeEvents.sessionHostChanged]} />}
      <div className="flex items-center justify-between gap-2">
        <Link href={`/leagues/${params.id}/roster`} className="text-brand-muted text-sm">← Back</Link>
        <RefreshButton />
      </div>

      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">League Play Manager</h1>
        <p className="text-sm text-brand-muted">{league.name} · Session {session.session_number} · {dateStr}</p>
      </div>

      {selfRun && (
        <HostControls
          sessionId={params.sessionId}
          leagueId={params.id}
          effectiveHostId={effectiveHostId}
          meId={user.id}
          isManager={isOwner || isCoAdmin}
          hostName={currentHostName}
          presentPlayers={presentPlayers}
        />
      )}

      <LiveSessionManager
        sessionId={params.sessionId}
        leagueId={params.id}
        initialPlayers={players ?? []}
        initialRounds={rounds ?? []}
        numberOfCourts={session.number_of_courts ?? 4}
        initialScoredRounds={scoredRoundNumbers}
        initialMatchScores={(matchScoreRows ?? []) as any[]}
        availableSubs={(availableProfiles ?? []).map(p => ({ id: p.id, name: p.name }))}
        subRequests={(subRequests ?? []) as any[]}
        format={(league as any).format ?? 'mixed_doubles'}
        teamByUserId={teamByUserId}
      />

    </main>
  )
}
