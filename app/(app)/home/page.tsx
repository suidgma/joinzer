import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import Link from 'next/link'
import PlayerCheckIn from '@/components/features/leagues/PlayerCheckIn'
import NeedsYourAttention from '@/components/features/home/NeedsYourAttention'
import { getHomeActionItems } from '@/lib/home/actionItems'
import RealtimeRefresh from '@/components/ui/RealtimeRefresh'
import { subRequestsTopic, RealtimeEvents } from '@/lib/realtime/topics'
import { formatSessionDate, formatTimestamp } from '@/lib/utils/date'
import { skillRangeToLevel } from '@/lib/taxonomy/formats'
import UpcomingEventsSection from '@/components/features/home/UpcomingEventsSection'

// Returns the ±1-tier skill range window for the discover query.
// Leagues whose [skill_min, skill_max] overlaps [lo, hi] are surfaced.
function matchingSkillRange(dupr: number | null, est: number | null): { lo: number; hi: number } | null {
  const r = dupr ?? est
  if (!r) return null
  let idx = 0
  if (r >= 4.0) idx = 4
  else if (r >= 3.5) idx = 3
  else if (r >= 3.0) idx = 2
  else if (r >= 2.5) idx = 1
  const MINS = [2.0, 2.5, 3.0, 3.5, 4.0]
  const MAXS = [2.5, 3.0, 3.5, 4.0, 4.5]
  return { lo: MINS[Math.max(0, idx - 1)], hi: MAXS[Math.min(4, idx + 1)] }
}

function sessionDateLabel(d: string) {
  return formatSessionDate(d)
}

function eventDateLabel(isoStr: string) {
  return formatTimestamp(isoStr)
}

// Small imminence pill for My Schedule. Returns null for anything past tomorrow.
function dayBadge(dateYmd: string, today: string, tomorrow: string): { label: string; cls: string } | null {
  if (dateYmd === today) return { label: 'Today', cls: 'bg-brand text-brand-dark' }
  if (dateYmd === tomorrow) return { label: 'Tomorrow', cls: 'bg-brand-soft text-brand-dark border border-brand-border' }
  return null
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
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const now = new Date().toISOString()

  // Wave 1 — everything that needs only the user id, run concurrently (incl. the profile,
  // joined events, tournament regs, and the Action Center, which no longer wait on the league ids).
  const [
    { data: registrations },
    { data: organizedLeagues },
    { data: organizedTournaments },
    { data: pendingPartnerRegs },
    { data: pendingTournamentInvites },
    { data: profile },
    { data: joinedEventRows },
    { data: tournamentRegistrations },
    actionItems,
  ] = await Promise.all([
    db.from('league_registrations').select('league_id').eq('user_id', user.id).eq('status', 'registered'),
    db.from('leagues').select('id, name, format, skill_min, skill_max, location_name, created_by').eq('created_by', user.id),
    db.from('tournaments').select('id').eq('organizer_id', user.id).limit(1),
    db.from('league_registrations')
      .select('id, league_id, leagues!league_id(id, name)')
      .eq('user_id', user.id)
      .eq('status', 'pending_partner'),
    // Tournament: captain sent a partner invite that hasn't been accepted yet.
    // Filter via the embedded inviter_reg join so only the current user's invites surface.
    db.from('tournament_team_invitations')
      .select(`
        id, invitee_email, tournament_id,
        inviter_reg:tournament_registrations!inviter_registration_id!inner(
          user_id,
          tournament:tournaments!tournament_id(id, name)
        )
      `)
      .eq('status', 'pending')
      .eq('inviter_reg.user_id', user.id),
    db.from('profiles').select('name, dupr_rating, estimated_rating, rating_source, gender, signup_intent, home_court:locations!home_court_id(lat, lng, city, state)').eq('id', user.id).single(),
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
    // Home "Needs your attention": own sub requests/statuses + (opt-in-gated) matched opportunities.
    getHomeActionItems(user.id),
  ])

  const registeredLeagueIds = (registrations ?? []).map((r) => r.league_id as string)
  const myLeagueIdSet = new Set([
    ...registeredLeagueIds,
    ...((organizedLeagues ?? []).map((l) => l.id as string)),
  ])
  const leagueIds = Array.from(myLeagueIdSet)

  // Wave 2 — needs the league ids from wave 1.
  const [{ data: registeredLeagueRows }, { data: upcomingSessions }] = await Promise.all([
    registeredLeagueIds.length > 0
      ? db.from('leagues').select('id, name, format, skill_min, skill_max, location_name, created_by').in('id', registeredLeagueIds)
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
  ])

  const skillRange = matchingSkillRange(
    (profile as any)?.dupr_rating ?? null,
    (profile as any)?.estimated_rating ?? null,
  )

  const sessionIds = (upcomingSessions ?? []).map((s) => s.id as string)

  // Wave 3 — needs the session ids from wave 2.
  const { data: attendance } = sessionIds.length > 0
    ? await db.from('league_session_attendance')
        .select('league_session_id, attendance_status')
        .eq('user_id', user.id)
        .in('league_session_id', sessionIds)
    : { data: [] as any[] }

  const homeCourt = (profile as any)?.home_court as { lat: number | null; lng: number | null; city: string | null; state: string | null } | null

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

  // Sessions already surfaced in "Needs your attention" (run-tonight / check-in) are hidden from
  // My Schedule so the same session doesn't appear twice. Only what's actually shown up top is
  // suppressed — a session that lost the Action Center cap still lists here.
  const actionSessionIds = new Set<string>()
  for (const it of actionItems) {
    if (it.type === 'run_session_today') actionSessionIds.add(it.run.sessionId)
    if (it.type === 'attendance_needed') actionSessionIds.add(it.attendance.sessionId)
  }
  const renderSchedule = scheduleItems.filter(
    (i) => !(i.kind === 'session' && actionSessionIds.has(i.data.id as string)),
  )
  const visibleSchedule = renderSchedule.slice(0, 3)

  // Imminence for the greeting — derived from the FULL footprint (a today session handled in the
  // Action Center still makes the greeting say "playing today").
  const itemYmd = (i: ScheduleItem) =>
    i.kind === 'session' ? (i.data.session_date as string)
    : i.kind === 'tournament' ? (i.data.start_date as string)
    : (i.data.starts_at as string).slice(0, 10)
  const hostingToday = scheduleItems.some((i) => i.kind === 'session' && i.isManager && itemYmd(i) === today)
  const hasTodayItem = scheduleItems.some((i) => itemYmd(i) === today)
  const hasTomorrowItem = scheduleItems.some((i) => itemYmd(i) === tomorrow)

  const firstName = (profile?.name as string | null)?.split(' ')[0] ?? 'there'
  const hasAnyUpcoming = scheduleItems.length > 0
  const hasSchedule = renderSchedule.length > 0
  const scheduleIsSparse = renderSchedule.length < 3
  const ratingSource = (profile as any)?.rating_source as string | null

  const excludeEventIds = (joinedEventRows ?? [])
    .map((row) => (row.event as any)?.id as string)
    .filter(Boolean)
  const excludeTournamentIds = (tournamentRegistrations ?? [])
    .map((reg) => (reg.tournament as any)?.id as string)
    .filter(Boolean)
  const ratingMissing = !ratingSource || ratingSource === 'skipped'
  const homeCourtMissing = !homeCourt
  const isOrganizer = (organizedLeagues?.length ?? 0) > 0 || (organizedTournaments?.length ?? 0) > 0
  // Declared an organize intent at signup but hasn't created anything yet → lead them
  // to the guided create-first-event flow instead of the generic Play/Organize card.
  const declaredOrganizer = (profile as any)?.signup_intent === 'organize' && !isOrganizer

  // Greeting ties into the imminence we surface elsewhere: today > tomorrow > generic.
  const greetingSubline = hostingToday
    ? "You're hosting today 🎾"
    : hasTodayItem
    ? "You're playing today 🎾"
    : hasTomorrowItem
    ? "You've got something on tomorrow."
    : hasSchedule
    ? "Here's what's coming up."
    : "Nothing on your schedule yet — here's what's available near you."

  // A brand-new player (no footprint, not a declared organizer) sees real nearby games pulled up
  // above the onboarding card; everyone else gets the full list at the bottom.
  const isNewPlayer = !hasAnyUpcoming && !declaredOrganizer
  const upcomingSection = (
    <UpcomingEventsSection
      viewerGender={(profile as any)?.gender ?? null}
      skillRange={skillRange}
      homeCourt={homeCourt}
      excludeLeagueIds={leagueIds}
      excludeEventIds={excludeEventIds}
      excludeTournamentIds={excludeTournamentIds}
      title={isNewPlayer ? 'Games near you' : 'Upcoming Events'}
      limit={isNewPlayer ? 4 : 8}
    />
  )

  return (
    <main className="max-w-lg mx-auto p-4 space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Hey, {firstName} 👋</h1>
        <p className="text-sm text-brand-muted">{greetingSubline}</p>
      </div>

      {/* ── Needs your attention (Action Center) — most urgent items first, above the minor nudges ── */}
      <RealtimeRefresh topic={subRequestsTopic()} events={[RealtimeEvents.subRequestsChanged]} />
      <NeedsYourAttention items={actionItems} />

      {/* Waiting-on-partner states (transient, event-specific) rank above the evergreen
          profile-setup nudge below — urgent-first applied to the amber zone too. */}
      {(pendingPartnerRegs ?? []).map((reg: any) => {
        const leagueName = reg.leagues?.name ?? 'your league'
        return (
          <Link
            key={reg.id}
            href={`/leagues/${reg.league_id}`}
            className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 hover:border-amber-300 transition-colors"
          >
            <span className="text-amber-500 text-lg flex-shrink-0">⏳</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-800">Waiting on your partner — {leagueName}</p>
              <p className="text-xs text-amber-700">
                Your partner hasn&apos;t confirmed yet. Your spot is held.
              </p>
            </div>
            <span className="text-amber-400 text-sm flex-shrink-0">→</span>
          </Link>
        )
      })}
      {(pendingTournamentInvites ?? []).map((inv: any) => {
        const tournamentName = inv.inviter_reg?.tournament?.name ?? 'your tournament'
        const tournamentId = inv.inviter_reg?.tournament?.id ?? inv.tournament_id
        return (
          <Link
            key={inv.id}
            href={`/tournaments/${tournamentId}`}
            className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 hover:border-amber-300 transition-colors"
          >
            <span className="text-amber-500 text-lg flex-shrink-0">⏳</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-800">Partner invite pending — {tournamentName}</p>
              <p className="text-xs text-amber-700">
                Waiting on {inv.invitee_email} to accept. Your spot is held.
              </p>
            </div>
            <span className="text-amber-400 text-sm flex-shrink-0">→</span>
          </Link>
        )
      })}

      {/* Profile-setup nudge — evergreen, low-urgency: one soft card (not alarming amber),
          listing only what's still missing. De-ranked below the transient states above. */}
      {(ratingMissing || homeCourtMissing) && (
        <Link
          href="/profile/edit"
          className="flex items-center gap-3 rounded-2xl border border-brand-border bg-brand-surface px-4 py-3 hover:bg-brand-soft transition-colors"
        >
          <span className="text-brand-muted text-lg flex-shrink-0">✨</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-brand-dark">Finish setting up your profile</p>
            <p className="text-xs text-brand-muted">
              Add your {[ratingMissing && 'skill rating', homeCourtMissing && 'home court'].filter(Boolean).join(' and ')} so we can show you the right games nearby.
            </p>
          </div>
          <span className="text-brand-muted text-sm flex-shrink-0">→</span>
        </Link>
      )}

      {/* Persistent entry to substitute opportunities — always visible, independent of open_to_subbing. */}
      <Link href="/subs" className="flex items-center justify-between gap-2 rounded-2xl border border-brand-border bg-brand-surface px-4 py-3 hover:bg-brand-soft transition-colors">
        <span className="text-sm font-semibold text-brand-dark">🎾 Sub opportunities</span>
        <span className="text-xs text-brand-active">Find a league to sub →</span>
      </Link>

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
                        <span className="text-brand-muted">League:</span> {league?.name ?? 'League'}
                        <span className="ml-1.5 text-brand-muted font-normal">· Session {s.session_number as number}</span>
                      </p>
                      <p className="text-xs text-brand-muted flex items-center gap-1.5">
                        {(() => { const b = dayBadge(s.session_date as string, today, tomorrow); return b && <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${b.cls}`}>{b.label}</span> })()}
                        {sessionDateLabel(s.session_date as string)}
                      </p>
                      {league?.location_name && (
                        <p className="text-xs text-brand-muted">{league.location_name as string}</p>
                      )}
                    </div>
                    <Link
                      href={`/leagues/${s.league_id as string}`}
                      className="shrink-0 text-xs text-brand-active hover:underline"
                    >
                      View →
                    </Link>
                  </div>
                  {isManager ? (
                    <Link
                      href={`/leagues/${s.league_id as string}/sessions/${s.id as string}/live`}
                      className="block w-full text-center py-2 mt-2 rounded-xl bg-brand text-brand-dark text-xs font-semibold hover:bg-brand-hover transition-colors"
                    >
                      Open Session Manager →
                    </Link>
                  ) : (
                    <PlayerCheckIn
                      sessionId={s.id as string}
                      leagueId={s.league_id as string}
                      initialStatus={myStatus as any}
                      leagueSkillLevel={skillRangeToLevel((league as any)?.skill_min ?? null, (league as any)?.skill_max ?? null)}
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
                  <p className="text-sm font-semibold text-brand-dark leading-snug">
                    <span className="text-brand-muted">Tournament:</span> {t.name}
                  </p>
                  {t.location?.name && <p className="text-xs text-brand-muted">{t.location.name}</p>}
                  <p className="text-xs text-brand-muted flex items-center gap-1.5">
                    {(() => { const b = dayBadge(t.start_date as string, today, tomorrow); return b && <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${b.cls}`}>{b.label}</span> })()}
                    {formatSessionDate(t.start_date)}
                  </p>
                </Link>
              )
            }

            // event
            const ev = item.data
            const joinedCount = (ev.event_participants ?? []).filter((p: any) => p.participant_status === 'joined').length
            return (
              <Link
                key={`e-${ev.id}`}
                href={`/play/${ev.id}`}
                className="block bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-1 hover:border-brand-active transition-colors"
              >
                <p className="text-sm font-semibold text-brand-dark leading-snug">
                  <span className="text-brand-muted">Play:</span> {ev.title}
                </p>
                {ev.location?.name && <p className="text-xs text-brand-muted">{ev.location.name}</p>}
                <p className="text-xs text-brand-muted flex items-center gap-1.5">
                  {(() => { const b = dayBadge((ev.starts_at as string).slice(0, 10), today, tomorrow); return b && <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${b.cls}`}>{b.label}</span> })()}
                  {eventDateLabel(ev.starts_at)}
                </p>
                <p className="text-xs text-brand-muted">{joinedCount} / {ev.max_players} players</p>
              </Link>
            )
          })}
        </section>
      )}

      {/* Brand-new player: pull real nearby games up above the onboarding card so the first
          thing on an empty home screen is something they can actually join. */}
      {isNewPlayer && upcomingSection}

      {/* ── Declared organizer, nothing created yet → guided first-event CTA ── */}
      {!hasAnyUpcoming && declaredOrganizer && (
        <section className="bg-brand-soft border border-brand-border rounded-2xl p-5 text-center space-y-3">
          <span className="text-2xl block">📋</span>
          <p className="text-sm font-semibold text-brand-dark">Ready to run your first event?</p>
          <p className="text-xs text-brand-muted max-w-xs mx-auto">Set up a league or tournament in a few minutes — we&apos;ll walk you through it.</p>
          <Link
            href="/get-started"
            className="block text-center text-sm font-semibold py-2.5 rounded-xl bg-brand text-brand-dark hover:bg-brand-hover transition-colors"
          >
            Create your first event →
          </Link>
          <Link href="/play" className="inline-block text-xs text-brand-muted underline underline-offset-2">
            Or find games to play
          </Link>
        </section>
      )}

      {/* ── First-event onboarding — shown only on a completely empty home screen ── */}
      {isNewPlayer && (
        <section className="bg-brand-soft border border-brand-border rounded-2xl p-5 space-y-3">
          <p className="text-sm font-semibold text-brand-dark">What do you want to do?</p>
          <div className="grid grid-cols-2 gap-3">
            {/* Player path */}
            <div className="bg-brand-surface border border-brand-border rounded-xl p-4 flex flex-col gap-2">
              <span className="text-xl">🏓</span>
              <p className="text-sm font-semibold text-brand-dark">Play</p>
              <p className="text-xs text-brand-muted leading-relaxed">Find open sessions, join leagues and tournaments.</p>
              <Link
                href="/play"
                className="mt-auto block text-center text-xs font-semibold py-2 rounded-lg bg-brand text-brand-dark hover:bg-brand-hover transition-colors"
              >
                Find Games
              </Link>
            </div>
            {/* Organizer path */}
            <div className="bg-brand-surface border border-brand-border rounded-xl p-4 flex flex-col gap-2">
              <span className="text-xl">📋</span>
              <p className="text-sm font-semibold text-brand-dark">Organize</p>
              <p className="text-xs text-brand-muted leading-relaxed">Run a league or tournament on Joinzer.</p>
              <div className="mt-auto space-y-1.5">
                <Link
                  href="/leagues/create"
                  className="block text-center text-xs font-semibold py-1.5 rounded-lg border border-brand-border text-brand-dark hover:bg-brand-soft transition-colors"
                >
                  Create League
                </Link>
                <Link
                  href="/tournaments/create"
                  className="block text-center text-xs font-semibold py-1.5 rounded-lg border border-brand-border text-brand-dark hover:bg-brand-soft transition-colors"
                >
                  Create Tournament
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Role-aware CTA — shown when schedule is sparse but not empty ── */}
      {scheduleIsSparse && hasSchedule && (
        <section className="flex gap-3">
          {isOrganizer ? (
            <>
              <Link
                href="/leagues/create"
                className="flex-1 text-center py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover transition-colors"
              >
                Create League
              </Link>
              <Link
                href="/tournaments/create"
                className="flex-1 text-center py-2.5 rounded-xl border border-brand-border text-brand-dark text-sm font-semibold hover:border-brand-active transition-colors"
              >
                Create Tournament
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/leagues"
                className="flex-1 text-center py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover transition-colors"
              >
                Browse Leagues
              </Link>
              <Link
                href="/play"
                className="flex-1 text-center py-2.5 rounded-xl border border-brand-border text-brand-dark text-sm font-semibold hover:border-brand-active transition-colors"
              >
                Find Games
              </Link>
            </>
          )}
        </section>
      )}

      {/* ── Upcoming Events — pulled up above for brand-new players, else here at the bottom ── */}
      {!isNewPlayer && upcomingSection}

    </main>
  )
}
