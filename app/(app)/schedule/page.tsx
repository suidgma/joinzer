export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import Link from 'next/link'
import { formatSessionDate, formatTimestamp } from '@/lib/utils/date'
import PlayerCheckIn from '@/components/features/leagues/PlayerCheckIn'

// ── Date grouping ─────────────────────────────────────────────────────────────

function getDateGroup(isoKey: string): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const item = new Date(isoKey)
  const itemDay = new Date(item.getFullYear(), item.getMonth(), item.getDate())
  const diffDays = Math.round((itemDay.getTime() - today.getTime()) / 86_400_000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays <= 7) return 'This Week'
  if (diffDays <= 14) return 'Next Week'
  if (diffDays <= 31) return 'This Month'
  return 'Later'
}

const GROUP_ORDER = ['Today', 'Tomorrow', 'This Week', 'Next Week', 'This Month', 'Later']

// ── Schedule item types ───────────────────────────────────────────────────────

type ScheduleItem =
  | { kind: 'session'; sortKey: string; data: any; league: any; myStatus: string; isManager: boolean }
  | { kind: 'event';   sortKey: string; data: any }
  | { kind: 'tournament'; sortKey: string; data: any }

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function SchedulePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const db = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const today = new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()

  // 1. Leagues user belongs to or organizes
  const [{ data: registrations }, { data: organizedLeagues }] = await Promise.all([
    db.from('league_registrations').select('league_id').eq('user_id', user.id).eq('status', 'registered'),
    db.from('leagues').select('id, name, format, skill_level, location_name, created_by').eq('created_by', user.id),
  ])

  const registeredLeagueIds = (registrations ?? []).map((r) => r.league_id as string)
  const leagueIds = Array.from(new Set([
    ...registeredLeagueIds,
    ...((organizedLeagues ?? []).map((l) => l.id as string)),
  ]))

  // 2. Fetch all upcoming items in parallel
  const [
    { data: registeredLeagueRows },
    { data: upcomingSessions },
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
      : Promise.resolve({ data: [] }),
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
        status,
        tournament:tournaments!tournament_id (
          id, name, start_date, status,
          location:locations!location_id (name)
        )
      `)
      .eq('user_id', user.id)
      .in('status', ['registered', 'confirmed', 'approved']),
  ])

  const sessionIds = (upcomingSessions ?? []).map((s) => s.id as string)
  const { data: attendance } = sessionIds.length > 0
    ? await db.from('league_session_attendance')
        .select('league_session_id, attendance_status')
        .eq('user_id', user.id)
        .in('league_session_id', sessionIds)
    : { data: [] }

  const attendanceMap = Object.fromEntries(
    (attendance ?? []).map((a) => [a.league_session_id as string, a.attendance_status as string])
  )

  const allMyLeagues = [
    ...(registeredLeagueRows ?? []),
    ...((organizedLeagues ?? []).filter((ol) => !registeredLeagueIds.includes(ol.id as string))),
  ]
  const leagueMap = Object.fromEntries(allMyLeagues.map((l) => [l.id as string, l]))

  // 3. Build unified sorted list
  const items: ScheduleItem[] = []

  for (const s of upcomingSessions ?? []) {
    const league = leagueMap[s.league_id as string]
    items.push({
      kind: 'session',
      sortKey: (s.session_date as string) + 'T12:00:00Z',
      data: s,
      league,
      myStatus: attendanceMap[s.id as string] ?? 'not_responded',
      isManager: league?.created_by === user.id,
    })
  }

  const upcomingEvents = (joinedEventRows ?? [])
    .map((row) => (row.event as any))
    .filter((ev) => ev && ev.starts_at >= now && (ev.status === 'open' || ev.status === 'full'))
  for (const ev of upcomingEvents) {
    items.push({ kind: 'event', sortKey: ev.starts_at, data: ev })
  }

  const seenTournamentIds = new Set<string>()
  for (const reg of tournamentRegistrations ?? []) {
    const t = reg.tournament as any
    if (!t || !t.start_date || t.start_date < today) continue
    if (seenTournamentIds.has(t.id)) continue
    seenTournamentIds.add(t.id)
    items.push({ kind: 'tournament', sortKey: t.start_date + 'T12:00:00Z', data: t })
  }

  items.sort((a, b) => new Date(a.sortKey).getTime() - new Date(b.sortKey).getTime())

  // 4. Group by relative date
  const grouped = new Map<string, ScheduleItem[]>()
  for (const item of items) {
    const group = getDateGroup(item.sortKey)
    if (!grouped.has(group)) grouped.set(group, [])
    grouped.get(group)!.push(item)
  }

  const orderedGroups = GROUP_ORDER.filter((g) => grouped.has(g))

  return (
    <main className="max-w-lg mx-auto p-4 pb-24 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-bold text-brand-dark">My Schedule</h1>
        <span className="text-xs text-brand-muted">{items.length} upcoming</span>
      </div>

      {items.length === 0 && (
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
          <p className="text-sm font-semibold text-brand-dark">Nothing scheduled yet.</p>
          <p className="text-xs text-brand-muted">Join a session, register for a league, or sign up for a tournament.</p>
          <div className="flex gap-2 justify-center mt-3">
            <Link href="/events" className="py-2 px-4 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover transition-colors">Find Play</Link>
            <Link href="/compete" className="py-2 px-4 rounded-xl border border-brand-border text-brand-dark text-sm font-medium hover:bg-brand-soft transition-colors">Browse Leagues</Link>
          </div>
        </div>
      )}

      {orderedGroups.map((group) => (
        <section key={group} className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-brand-muted">{group}</h2>

          {grouped.get(group)!.map((item) => {
            if (item.kind === 'session') {
              const s = item.data
              const { league, myStatus, isManager } = item
              return (
                <div key={`s-${s.id}`} className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-brand/20 text-brand-dark">League</span>
                        <p className="text-sm font-semibold text-brand-dark truncate">
                          {league?.name ?? 'League'}
                        </p>
                      </div>
                      <p className="text-xs text-brand-muted mt-0.5">
                        Session {s.session_number as number} · {formatSessionDate(s.session_date as string)}
                      </p>
                      {league?.location_name && (
                        <p className="text-xs text-brand-muted">{league.location_name as string}</p>
                      )}
                    </div>
                    <Link href={`/compete/leagues/${s.league_id as string}`} className="shrink-0 text-xs text-brand-active hover:underline">
                      View →
                    </Link>
                  </div>
                  {isManager ? (
                    <Link
                      href={`/compete/leagues/${s.league_id as string}/sessions/${s.id as string}/live`}
                      className="block w-full text-center py-2 rounded-xl bg-brand text-brand-dark text-xs font-semibold hover:bg-brand-hover transition-colors"
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
                  className="block bg-brand-surface border border-brand-border rounded-2xl p-4 hover:border-brand-active transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">Tournament</span>
                        <p className="text-sm font-semibold text-brand-dark truncate">{t.name}</p>
                      </div>
                      {t.location?.name && <p className="text-xs text-brand-muted mt-0.5">{t.location.name}</p>}
                      <p className="text-xs text-brand-muted">{formatSessionDate(t.start_date)}</p>
                    </div>
                    <span className="text-xs text-brand-active shrink-0">View →</span>
                  </div>
                </Link>
              )
            }

            // event
            const ev = item.data
            const joinedCount = (ev.event_participants ?? []).filter((p: any) => p.participant_status === 'joined').length
            const isClinic = ev.session_type === 'free_clinic' || ev.session_type === 'paid_clinic'
            return (
              <Link
                key={`e-${ev.id}`}
                href={`/events/${ev.id}`}
                className="block bg-brand-surface border border-brand-border rounded-2xl p-4 hover:border-brand-active transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-brand text-brand-dark">
                        {isClinic ? 'Clinic' : 'Play'}
                      </span>
                      <p className="text-sm font-semibold text-brand-dark truncate">{ev.title}</p>
                    </div>
                    {ev.location?.name && <p className="text-xs text-brand-muted mt-0.5">{ev.location.name}</p>}
                    <p className="text-xs text-brand-muted">{formatTimestamp(ev.starts_at)}</p>
                    <p className="text-xs text-brand-muted">{joinedCount} / {ev.max_players} players</p>
                  </div>
                  <span className="text-xs text-brand-active shrink-0">View →</span>
                </div>
              </Link>
            )
          })}
        </section>
      ))}
    </main>
  )
}
