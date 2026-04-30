import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import Link from 'next/link'
import PlayerCheckIn from '@/components/features/leagues/PlayerCheckIn'
import SubRequestsSection from '@/components/features/leagues/SubRequestsSection'

const FORMAT_LABELS: Record<string, string> = {
  individual_round_robin: 'Individual RR',
  mens_doubles: "Men's Doubles",
  womens_doubles: "Women's Doubles",
  mixed_doubles: 'Mixed Doubles',
  coed_doubles: 'Coed Doubles',
  singles: 'Singles',
  custom: 'Custom',
}

function sessionDateLabel(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

export default async function HomePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null // layout handles redirect

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const today = new Date().toISOString().slice(0, 10)

  // All user's active league registrations
  const { data: registrations } = await db
    .from('league_registrations')
    .select('league_id')
    .eq('user_id', user.id)
    .eq('status', 'registered')

  const leagueIds = (registrations ?? []).map((r) => r.league_id as string)

  // Fetch leagues, upcoming sessions, attendance, sub requests in parallel
  const [
    { data: leagues },
    { data: upcomingSessions },
    { data: profile },
  ] = await Promise.all([
    leagueIds.length > 0
      ? db.from('leagues').select('id, name, format, skill_level, location_name, created_by').in('id', leagueIds)
      : Promise.resolve({ data: [] }),
    leagueIds.length > 0
      ? db.from('league_sessions')
          .select('id, league_id, session_number, session_date, status')
          .in('league_id', leagueIds)
          .gte('session_date', today)
          .in('status', ['scheduled', 'in_progress'])
          .order('session_date', { ascending: true })
          .limit(10)
      : Promise.resolve({ data: [] }),
    db.from('profiles').select('name').eq('id', user.id).single(),
  ])

  const sessionIds = (upcomingSessions ?? []).map((s) => s.id as string)

  const [{ data: attendance }, { data: openSubRequests }] = await Promise.all([
    sessionIds.length > 0
      ? db.from('league_session_attendance')
          .select('league_session_id, attendance_status')
          .eq('user_id', user.id)
          .in('league_session_id', sessionIds)
      : Promise.resolve({ data: [] }),
    leagueIds.length > 0
      ? db.from('league_sub_requests')
          .select(`
            id, league_id, league_session_id, status, notes,
            requesting_player:profiles!requesting_player_id(name),
            claimed_by:profiles!claimed_by_user_id(name),
            session:league_sessions!league_session_id(session_date, session_number),
            league:leagues!league_id(name)
          `)
          .in('league_id', leagueIds)
          .eq('status', 'open')
          .neq('requesting_player_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
  ])

  const attendanceMap = Object.fromEntries(
    (attendance ?? []).map((a) => [a.league_session_id as string, a.attendance_status as string])
  )

  const leagueMap = Object.fromEntries((leagues ?? []).map((l) => [l.id as string, l]))

  // Group sessions by league for "my leagues" section
  const sessionsByLeague: Record<string, typeof upcomingSessions> = {}
  for (const s of upcomingSessions ?? []) {
    const lid = s.league_id as string
    if (!sessionsByLeague[lid]) sessionsByLeague[lid] = []
    sessionsByLeague[lid]!.push(s)
  }

  // Next 3 upcoming sessions across all leagues
  const nextSessions = (upcomingSessions ?? []).slice(0, 3)

  const firstName = (profile?.name as string | null)?.split(' ')[0] ?? 'there'

  return (
    <main className="max-w-lg mx-auto p-4 space-y-5">
      {/* Greeting */}
      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Hey, {firstName} 👋</h1>
        <p className="text-sm text-brand-muted">
          {nextSessions.length > 0 ? "Here's what's coming up." : "No upcoming sessions right now."}
        </p>
      </div>

      {/* ── Upcoming sessions ── */}
      {nextSessions.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-heading text-base font-bold text-brand-dark">Upcoming Sessions</h2>
          {nextSessions.map((s) => {
            const league = leagueMap[s.league_id as string]
            const myStatus = (attendanceMap[s.id as string] ?? 'not_responded') as
              'planning_to_attend' | 'cannot_attend' | 'checked_in_present' | 'running_late' | 'not_responded'
            const isManager = league?.created_by === user.id

            return (
              <div key={s.id as string} className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-brand-dark">
                      {league?.name ?? 'League'}
                      <span className="ml-1.5 text-brand-muted font-normal">· Session {s.session_number as number}</span>
                    </p>
                    <p className="text-xs text-brand-muted">{sessionDateLabel(s.session_date as string)}</p>
                    {league?.location_name && (
                      <p className="text-xs text-brand-muted">{league.location_name as string}</p>
                    )}
                  </div>
                  <Link
                    href={`/compete/leagues/${s.league_id as string}`}
                    className="shrink-0 text-xs text-brand-active hover:underline"
                  >
                    View →
                  </Link>
                </div>

                {isManager ? (
                  <Link
                    href={`/compete/leagues/${s.league_id as string}/sessions/${s.id as string}/live`}
                    className="block w-full text-center py-2 mt-2 rounded-xl bg-brand text-brand-dark text-xs font-semibold hover:bg-brand-hover transition-colors"
                  >
                    Open Session Manager →
                  </Link>
                ) : (
                  <PlayerCheckIn
                    sessionId={s.id as string}
                    leagueId={s.league_id as string}
                    initialStatus={myStatus}
                    leagueSkillLevel={(league?.skill_level as string | null) ?? null}
                  />
                )}
              </div>
            )
          })}
        </section>
      )}

      {/* ── My leagues ── */}
      {(leagues ?? []).length > 0 && (
        <section className="space-y-3">
          <h2 className="font-heading text-base font-bold text-brand-dark">My Leagues</h2>
          {(leagues ?? []).map((league) => {
            const nextSession = (sessionsByLeague[league.id as string] ?? [])[0]
            const isManager = league.created_by === user.id
            return (
              <div key={league.id as string} className="bg-brand-surface border border-brand-border rounded-2xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-brand-dark">
                      {league.name as string}
                      {isManager && <span className="ml-1.5 text-[10px] font-bold bg-brand text-brand-dark px-1.5 py-0.5 rounded-full">Organizer</span>}
                    </p>
                    <p className="text-xs text-brand-muted">
                      {FORMAT_LABELS[league.format as string] ?? league.format as string}
                    </p>
                    {nextSession ? (
                      <p className="text-xs text-brand-muted mt-0.5">
                        Next: Session {nextSession.session_number as number} · {sessionDateLabel(nextSession.session_date as string)}
                      </p>
                    ) : (
                      <p className="text-xs text-brand-muted mt-0.5">No upcoming sessions</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 items-end shrink-0">
                    <Link href={`/compete/leagues/${league.id as string}`} className="text-xs text-brand-active hover:underline">View</Link>
                    <Link href={`/compete/leagues/${league.id as string}/standings`} className="text-xs text-brand-muted hover:underline">Standings</Link>
                    {isManager && (
                      <Link href={`/compete/leagues/${league.id as string}/roster`} className="text-xs text-brand-muted hover:underline">Manage</Link>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </section>
      )}

      {/* ── Open sub requests in my leagues ── */}
      {(openSubRequests ?? []).length > 0 && (
        <SubRequestsSection
          initialRequests={(openSubRequests ?? []) as any[]}
          currentUserId={user.id}
        />
      )}

      {/* Empty state */}
      {leagueIds.length === 0 && (
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
          <p className="text-sm font-semibold text-brand-dark">You&apos;re not in any leagues yet.</p>
          <p className="text-xs text-brand-muted">Browse available leagues and register to get started.</p>
          <Link
            href="/compete"
            className="inline-block mt-2 py-2 px-4 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover transition-colors"
          >
            Browse Leagues →
          </Link>
        </div>
      )}
    </main>
  )
}
