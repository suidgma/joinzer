import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import LiveSessionManager from './LiveSessionManager'

export default async function LiveSessionPage({
  params,
}: {
  params: { id: string; sessionId: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const db = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const [{ data: league }, { data: session }] = await Promise.all([
    db.from('leagues').select('id, name, created_by').eq('id', params.id).single(),
    db.from('league_sessions').select('id, session_number, session_date, status, number_of_courts, rounds_planned').eq('id', params.sessionId).single(),
  ])

  if (!league || !session) notFound()
  if (league.created_by !== user.id) redirect(`/compete/leagues/${params.id}`)

  // --- Sync session players: seed missing roster players on every load ---
  const [{ data: existingSessionPlayers }, { data: existingAttendance }, { data: registrations }, { data: sessionSubs }] = await Promise.all([
    db.from('league_session_players').select('user_id').eq('session_id', params.sessionId),
    db.from('league_session_attendance').select('user_id, attendance_status').eq('league_session_id', params.sessionId),
    db.from('league_registrations')
      .select('user_id, profile:profiles(id, name, joinzer_rating, dupr_rating, estimated_rating)')
      .eq('league_id', params.id)
      .eq('status', 'registered'),
    db.from('league_session_subs')
      .select('user_id, profile:profiles(id, name, joinzer_rating)')
      .eq('session_id', params.sessionId),
  ])

  const seededUserIds = new Set((existingSessionPlayers ?? []).map(p => p.user_id as string))

  const selfStatusMap: Record<string, string> = {}
  for (const a of existingAttendance ?? []) {
    selfStatusMap[a.user_id as string] = a.attendance_status as string
  }

  const resolveActualStatus = (userId: string): string => {
    const self = selfStatusMap[userId]
    if (self === 'checked_in_present') return 'present'
    if (self === 'planning_to_attend') return 'coming'
    if (self === 'running_late') return 'late'
    if (self === 'cannot_attend') return 'cannot_attend'
    return 'not_present'
  }

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

  // Insert any session subs not yet in session players (first-open only effectively)
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

  // --- Fetch current session players ---
  const { data: players } = await db
    .from('league_session_players')
    .select('*')
    .eq('session_id', params.sessionId)
    .order('player_type')
    .order('display_name')

  // --- Fetch player self-check-in statuses ---
  const { data: attendanceRows } = await db
    .from('league_session_attendance')
    .select('user_id, attendance_status, checked_in_at')
    .eq('league_session_id', params.sessionId)

  const attendanceByUserId = Object.fromEntries(
    (attendanceRows ?? []).map((a) => [a.user_id as string, a.attendance_status as string])
  )

  // --- Fetch open sub requests for this session ---
  const { data: subRequests } = await db
    .from('league_sub_requests')
    .select(`
      id, status, requesting_player_id, claimed_by_user_id,
      requesting_player:profiles!requesting_player_id(name),
      claimed_by:profiles!claimed_by_user_id(name)
    `)
    .eq('league_session_id', params.sessionId)
    .in('status', ['open', 'claimed', 'approved'])

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

  // --- Which rounds have at least one score entered ---
  const { data: scoredMatchRows } = await db
    .from('league_matches')
    .select('round_number')
    .eq('session_id', params.sessionId)
    .not('team1_score', 'is', null)
  const scoredRoundNumbers = Array.from(new Set((scoredMatchRows ?? []).map(r => r.round_number as number)))

  const dateStr = new Date(session.session_date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href={`/compete/leagues/${params.id}/roster`} className="text-brand-muted text-sm">← Back</Link>
      </div>

      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">League Play Manager</h1>
        <p className="text-sm text-brand-muted">{league.name} · Session {session.session_number} · {dateStr}</p>
      </div>

      <LiveSessionManager
        sessionId={params.sessionId}
        leagueId={params.id}
        initialPlayers={players ?? []}
        initialRounds={rounds ?? []}
        numberOfCourts={session.number_of_courts ?? 4}
        roundsPlanned={session.rounds_planned ?? 7}
        initialScoredRounds={scoredRoundNumbers}
        availableSubs={(availableProfiles ?? []).map(p => ({ id: p.id, name: p.name }))}
        attendanceByUserId={attendanceByUserId}
        subRequests={(subRequests ?? []) as any[]}
      />

    </main>
  )
}
