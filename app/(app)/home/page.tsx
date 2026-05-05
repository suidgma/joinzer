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

const SKILL_LABELS: Record<string, string> = {
  beginner:          'Beginner',
  beginner_plus:     'Beginner+',
  intermediate:      'Intermediate',
  intermediate_plus: 'Intermediate+',
  advanced:          'Advanced',
}

const ALL_SKILL_TIERS = ['beginner', 'beginner_plus', 'intermediate', 'intermediate_plus', 'advanced']

function matchingSkillLevels(duprRating: number | null, estimatedRating: number | null): string[] {
  const r = duprRating ?? estimatedRating
  if (!r) return ALL_SKILL_TIERS
  let idx = 0
  if (r >= 4.0) idx = 4
  else if (r >= 3.5) idx = 3
  else if (r >= 3.0) idx = 2
  else if (r >= 2.5) idx = 1
  return ALL_SKILL_TIERS.slice(Math.max(0, idx - 1), idx + 2)
}

function sessionDateLabel(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function eventDateLabel(isoStr: string) {
  return new Date(isoStr).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export default async function HomePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null // layout handles redirect

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const today = new Date().toISOString().slice(0, 10)

  // All user's active league registrations + leagues they organize
  const [{ data: registrations }, { data: organizedLeagues }] = await Promise.all([
    db.from('league_registrations').select('league_id').eq('user_id', user.id).eq('status', 'registered'),
    db.from('leagues').select('id, name, format, skill_level, location_name, created_by').eq('created_by', user.id),
  ])

  const registeredLeagueIds = (registrations ?? []).map((r) => r.league_id as string)
  // Merge registered + organized league IDs (deduplicated)
  const myLeagueIdSet = new Set([
    ...registeredLeagueIds,
    ...((organizedLeagues ?? []).map((l) => l.id as string)),
  ])
  const leagueIds = Array.from(myLeagueIdSet)

  // Fetch leagues, upcoming sessions, play events, and profile in parallel
  const [
    { data: registeredLeagueRows },
    { data: upcomingSessions },
    { data: profile },
    { data: joinedEventRows },
  ] = await Promise.all([
    registeredLeagueIds.length > 0
      ? db.from('leagues').select('id, name, format, skill_level, location_name, created_by').in('id', registeredLeagueIds)
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
    db.from('profiles').select('name, dupr_rating, estimated_rating').eq('id', user.id).single(),
    // Events the user is joined in (not just captain — any joined participant)
    db.from('event_participants')
      .select(`
        event:events!event_id (
          id, title, starts_at, max_players, status, session_type,
          location:locations!location_id (name),
          event_participants!event_id (participant_status)
        )
      `)
      .eq('user_id', user.id)
      .eq('participant_status', 'joined'),
  ])

  // Skill-matched league discovery
  const skillTiers = matchingSkillLevels(
    (profile as any)?.dupr_rating ?? null,
    (profile as any)?.estimated_rating ?? null,
  )

  const sessionIds = (upcomingSessions ?? []).map((s) => s.id as string)

  const [{ data: attendance }, { data: openSubRequests }, { data: discoverLeagues }, { data: upcomingTournaments }] = await Promise.all([
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
    // Leagues near user's skill level they haven't joined/organized
    (() => {
      let q = db.from('leagues')
        .select('id, name, format, skill_level, location_name, registration_status, start_date')
        .in('skill_level', skillTiers)
        .in('registration_status', ['open', 'waitlist_only'])
        .order('start_date', { ascending: true, nullsFirst: false })
        .limit(5)
      if (leagueIds.length > 0) q = q.not('id', 'in', `(${leagueIds.join(',')})`)
      return q
    })(),
    // Upcoming public tournaments
    db.from('tournaments')
      .select('id, name, start_date, location:locations!location_id(name)')
      .eq('status', 'published')
      .eq('visibility', 'public')
      .gte('start_date', today)
      .order('start_date', { ascending: true })
      .limit(5),
  ])

  // Upcoming joined play events (future only, sorted by starts_at)
  const now = new Date().toISOString()
  const upcomingEvents = (joinedEventRows ?? [])
    .map((row) => (row.event as any))
    .filter((ev) => ev && ev.starts_at >= now && (ev.status === 'open' || ev.status === 'full'))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 5)

  const attendanceMap = Object.fromEntries(
    (attendance ?? []).map((a) => [a.league_session_id as string, a.attendance_status as string])
  )

  // Merge registered leagues + organized leagues (deduplicated by id)
  const allMyLeagues = [
    ...(registeredLeagueRows ?? []),
    ...(organizedLeagues ?? []).filter(ol => !registeredLeagueIds.includes(ol.id as string)),
  ]
  const leagueMap = Object.fromEntries(allMyLeagues.map((l) => [l.id as string, l]))

  // Group sessions by league for "my leagues" section
  type Session = NonNullable<typeof upcomingSessions>[number]
  const sessionsByLeague: Record<string, Session[]> = {}
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
          {nextSessions.length > 0 || upcomingEvents.length > 0 ? "Here's what's coming up." : "No upcoming sessions right now."}
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

      {/* ── Upcoming play sessions (events) ── */}
      {upcomingEvents.length > 0 && (
        <section className="space-y-3">
          {upcomingEvents.map((ev) => {
            const joinedCount = (ev.event_participants ?? []).filter((p: any) => p.participant_status === 'joined').length
            return (
              <Link
                key={ev.id}
                href={`/events/${ev.id}`}
                className="block bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-1 hover:border-brand-active transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-brand-dark leading-snug">{ev.title}</p>
                  <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand text-brand-dark capitalize">
                    {ev.status}
                  </span>
                </div>
                {ev.location?.name && (
                  <p className="text-xs text-brand-muted">{ev.location.name}</p>
                )}
                <p className="text-xs text-brand-muted">{eventDateLabel(ev.starts_at)}</p>
                <p className="text-xs text-brand-muted">{joinedCount} / {ev.max_players} players</p>
              </Link>
            )
          })}
        </section>
      )}

      {/* ── My leagues ── */}
      {allMyLeagues.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-heading text-base font-bold text-brand-dark">My Leagues</h2>
          {allMyLeagues.map((league) => {
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

      {/* ── Leagues near your skill level ── */}
      {(discoverLeagues ?? []).length > 0 && (
        <section className="space-y-3">
          <h2 className="font-heading text-base font-bold text-brand-dark">Leagues Near Your Level</h2>
          {(discoverLeagues ?? []).map((league) => (
            <Link
              key={league.id as string}
              href={`/compete/leagues/${league.id as string}`}
              className="block bg-brand-surface border border-brand-border rounded-2xl p-4 hover:border-brand-active transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-brand-dark">{league.name as string}</p>
                  <p className="text-xs text-brand-muted">
                    {FORMAT_LABELS[league.format as string] ?? league.format as string}
                    {' · '}
                    {SKILL_LABELS[league.skill_level as string] ?? league.skill_level as string}
                  </p>
                  {league.location_name && (
                    <p className="text-xs text-brand-muted">{league.location_name as string}</p>
                  )}
                  {league.start_date && (
                    <p className="text-xs text-brand-muted">Starts {sessionDateLabel(league.start_date as string)}</p>
                  )}
                </div>
                <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand text-brand-dark capitalize">
                  {league.registration_status === 'waitlist_only' ? 'Waitlist' : 'Open'}
                </span>
              </div>
            </Link>
          ))}
        </section>
      )}

      {/* ── Upcoming tournaments ── */}
      {(upcomingTournaments ?? []).length > 0 && (
        <section className="space-y-3">
          <h2 className="font-heading text-base font-bold text-brand-dark">Upcoming Tournaments</h2>
          {(upcomingTournaments ?? []).map((t) => (
            <Link
              key={t.id as string}
              href={`/compete/tournaments/${t.id as string}`}
              className="block bg-brand-surface border border-brand-border rounded-2xl p-4 hover:border-brand-active transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-brand-dark">{t.name as string}</p>
                  {(t.location as any)?.name && (
                    <p className="text-xs text-brand-muted">{(t.location as any).name}</p>
                  )}
                  {t.start_date && (
                    <p className="text-xs text-brand-muted">{sessionDateLabel(t.start_date as string)}</p>
                  )}
                </div>
                <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand/20 text-brand-dark">
                  Tournament
                </span>
              </div>
            </Link>
          ))}
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
      {leagueIds.length === 0 && upcomingEvents.length === 0 && (
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
