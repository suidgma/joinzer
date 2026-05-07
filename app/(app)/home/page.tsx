import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import Link from 'next/link'
import PlayerCheckIn from '@/components/features/leagues/PlayerCheckIn'
import SubRequestsSection from '@/components/features/leagues/SubRequestsSection'
import { formatSessionDate, formatTimestamp } from '@/lib/utils/date'

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
  return formatSessionDate(d)
}

function eventDateLabel(isoStr: string) {
  return formatTimestamp(isoStr)
}

// Haversine distance in miles between two lat/lng points
function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

// Unified schedule item for chronological sort
type ScheduleItem =
  | { kind: 'session'; sortKey: string; data: any; league: any; myStatus: string; isManager: boolean }
  | { kind: 'event'; sortKey: string; data: any }
  | { kind: 'tournament'; sortKey: string; data: any }

export default async function HomePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const today = new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()

  // Leagues user is registered in or organizes
  const [{ data: registrations }, { data: organizedLeagues }] = await Promise.all([
    db.from('league_registrations').select('league_id').eq('user_id', user.id).eq('status', 'registered'),
    db.from('leagues').select('id, name, format, skill_level, location_name, created_by').eq('created_by', user.id),
  ])

  const registeredLeagueIds = (registrations ?? []).map((r) => r.league_id as string)
  const myLeagueIdSet = new Set([
    ...registeredLeagueIds,
    ...((organizedLeagues ?? []).map((l) => l.id as string)),
  ])
  const leagueIds = Array.from(myLeagueIdSet)

  const [
    { data: registeredLeagueRows },
    { data: upcomingSessions },
    { data: profile },
    { data: joinedEventRows },
    { data: tournamentRegistrations },
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
          .limit(15)
      : Promise.resolve({ data: [] }),
    db.from('profiles').select('name, dupr_rating, estimated_rating, home_court:locations!home_court_id(lat, lng)').eq('id', user.id).single(),
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
    db.from('tournament_registrations')
      .select(`
        tournament:tournaments!tournament_id (
          id, name, start_date,
          location:locations!location_id (name)
        )
      `)
      .eq('user_id', user.id)
      .in('status', ['registered', 'confirmed', 'approved']),
  ])

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
    (() => {
      let q = db.from('leagues')
        .select('id, name, format, skill_level, location_name, registration_status, start_date, location:locations!location_id(lat, lng)')
        .in('skill_level', skillTiers)
        .in('registration_status', ['open', 'waitlist_only'])
        .order('start_date', { ascending: true, nullsFirst: false })
        .limit(20)
      if (leagueIds.length > 0) q = q.not('id', 'in', `(${leagueIds.join(',')})`)
      return q
    })(),
    db.from('tournaments')
      .select('id, name, start_date, location:locations!location_id(name, lat, lng)')
      .eq('status', 'published')
      .eq('visibility', 'public')
      .gte('start_date', today)
      .order('start_date', { ascending: true })
      .limit(20),
  ])

  const homeCourt = (profile as any)?.home_court as { lat: number; lng: number } | null

  // Sort leagues by distance from home court if available, otherwise by start_date
  const sortedDiscoverLeagues = [...(discoverLeagues ?? [])].sort((a, b) => {
    if (homeCourt) {
      const aLat = (a.location as any)?.lat
      const aLng = (a.location as any)?.lng
      const bLat = (b.location as any)?.lat
      const bLng = (b.location as any)?.lng
      if (aLat && bLat) {
        return (
          distanceMiles(homeCourt.lat, homeCourt.lng, aLat, aLng) -
          distanceMiles(homeCourt.lat, homeCourt.lng, bLat, bLng)
        )
      }
      if (aLat) return -1
      if (bLat) return 1
    }
    return (a.start_date as string ?? '').localeCompare(b.start_date as string ?? '')
  }).slice(0, 6)

  // Sort tournaments by distance from home court if available, otherwise by date
  const sortedTournaments = [...(upcomingTournaments ?? [])].sort((a, b) => {
    if (homeCourt) {
      const aLat = (a.location as any)?.lat
      const aLng = (a.location as any)?.lng
      const bLat = (b.location as any)?.lat
      const bLng = (b.location as any)?.lng
      if (aLat && bLat) {
        return (
          distanceMiles(homeCourt.lat, homeCourt.lng, aLat, aLng) -
          distanceMiles(homeCourt.lat, homeCourt.lng, bLat, bLng)
        )
      }
    }
    return (a.start_date as string ?? '').localeCompare(b.start_date as string ?? '')
  }).slice(0, 5)

  const attendanceMap = Object.fromEntries(
    (attendance ?? []).map((a) => [a.league_session_id as string, a.attendance_status as string])
  )

  const allMyLeagues = [
    ...(registeredLeagueRows ?? []),
    ...(organizedLeagues ?? []).filter((ol) => !registeredLeagueIds.includes(ol.id as string)),
  ]
  const leagueMap = Object.fromEntries(allMyLeagues.map((l) => [l.id as string, l]))

  // Build unified chronological schedule
  const scheduleItems: ScheduleItem[] = []

  for (const s of upcomingSessions ?? []) {
    const league = leagueMap[s.league_id as string]
    const myStatus = (attendanceMap[s.id as string] ?? 'not_responded') as string
    const isManager = league?.created_by === user.id
    scheduleItems.push({
      kind: 'session',
      sortKey: (s.session_date as string) + 'T12:00:00Z',
      data: s,
      league,
      myStatus,
      isManager,
    })
  }

  const upcomingEvents = (joinedEventRows ?? [])
    .map((row) => (row.event as any))
    .filter((ev) => ev && ev.starts_at >= now && (ev.status === 'open' || ev.status === 'full'))

  for (const ev of upcomingEvents) {
    scheduleItems.push({ kind: 'event', sortKey: ev.starts_at, data: ev })
  }

  const seenTournamentIds = new Set<string>()
  for (const reg of tournamentRegistrations ?? []) {
    const t = reg.tournament as any
    if (!t || !t.start_date || t.start_date < today) continue
    if (seenTournamentIds.has(t.id)) continue
    seenTournamentIds.add(t.id)
    scheduleItems.push({ kind: 'tournament', sortKey: t.start_date + 'T12:00:00Z', data: t })
  }

  scheduleItems.sort((a, b) => new Date(a.sortKey).getTime() - new Date(b.sortKey).getTime())
  const visibleSchedule = scheduleItems.slice(0, 5)

  const firstName = (profile?.name as string | null)?.split(' ')[0] ?? 'there'
  const hasSchedule = visibleSchedule.length > 0
  const scheduleIsSparse = scheduleItems.length < 3
  const hasDiscover = sortedDiscoverLeagues.length > 0 || sortedTournaments.length > 0

  return (
    <main className="max-w-lg mx-auto p-4 space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Hey, {firstName} 👋</h1>
        <p className="text-sm text-brand-muted">
          {hasSchedule ? "Here's what's coming up." : "Nothing on your schedule yet — check out what's available below."}
        </p>
      </div>

      {/* ── My Schedule ── */}
      {hasSchedule && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-base font-bold text-brand-dark">My Schedule</h2>
            <Link href="/schedule" className="text-xs text-brand-active hover:underline">See all →</Link>
          </div>
          {visibleSchedule.map((item) => {
            if (item.kind === 'session') {
              const s = item.data
              const { league, myStatus, isManager } = item
              return (
                <div key={`s-${s.id}`} className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-1">
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
                      initialStatus={myStatus as any}
                      leagueSkillLevel={(league?.skill_level as string | null) ?? null}
                    />
                  )}
                </div>
              )
            }

            if (item.kind === 'tournament') {
              const t = item.data
              return (
                <Link
                  key={`t-${t.id}`}
                  href={`/tournaments/${t.id}`}
                  className="block bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-1 hover:border-brand-active transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-brand-dark leading-snug">{t.name}</p>
                    <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand/20 text-brand-dark">
                      Tournament
                    </span>
                  </div>
                  {t.location?.name && <p className="text-xs text-brand-muted">{t.location.name}</p>}
                  <p className="text-xs text-brand-muted">{formatSessionDate(t.start_date)}</p>
                </Link>
              )
            }

            // event
            const ev = item.data
            const joinedCount = (ev.event_participants ?? []).filter((p: any) => p.participant_status === 'joined').length
            return (
              <Link
                key={`e-${ev.id}`}
                href={`/events/${ev.id}`}
                className="block bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-1 hover:border-brand-active transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-brand-dark leading-snug">{ev.title}</p>
                  <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand text-brand-dark capitalize">
                    Play
                  </span>
                </div>
                {ev.location?.name && <p className="text-xs text-brand-muted">{ev.location.name}</p>}
                <p className="text-xs text-brand-muted">{eventDateLabel(ev.starts_at)}</p>
                <p className="text-xs text-brand-muted">{joinedCount} / {ev.max_players} players</p>
              </Link>
            )
          })}
        </section>
      )}

      {/* ── Discover (always if sparse, always if no schedule) ── */}
      {(scheduleIsSparse || !hasSchedule) && hasDiscover && (
        <section className="space-y-5">
          <h2 className="font-heading text-base font-bold text-brand-dark">
            {hasSchedule ? 'More to Explore' : 'Find Your Game'}
          </h2>

          {/* Featured leagues */}
          {sortedDiscoverLeagues.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-brand-dark">Leagues Near Your Level</h3>
                <Link href="/compete" className="text-xs text-brand-active hover:underline">See all →</Link>
              </div>
              {sortedDiscoverLeagues.map((league) => (
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
            </div>
          )}

          {/* Upcoming tournaments */}
          {sortedTournaments.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-brand-dark">Upcoming Tournaments</h3>
                <Link href="/compete" className="text-xs text-brand-active hover:underline">See all →</Link>
              </div>
              {sortedTournaments.map((t) => (
                <Link
                  key={t.id as string}
                  href={`/tournaments/${t.id as string}`}
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
            </div>
          )}
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
      {!hasSchedule && !hasDiscover && (
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
          <p className="text-sm font-semibold text-brand-dark">Nothing here yet.</p>
          <p className="text-xs text-brand-muted">Browse leagues and tournaments to get started.</p>
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
