import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import { leagueNavItems } from '@/lib/leagues/leagueNav'
import { skillRangeToLevel } from '@/lib/taxonomy/formats'
import PlayerSchedule from '../PlayerSchedule'
import WhoIsComing from '../WhoIsComing'
import AutoRefresh from '@/components/ui/AutoRefresh'
import RefreshButton from '@/components/ui/RefreshButton'
import { formatSessionDate } from '@/lib/utils/date'

export const dynamic = 'force-dynamic'

export default async function LeagueSchedulePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: league } = await supabase
    .from('leagues')
    .select('id, name, created_by, format_kind, skill_min, skill_max')
    .eq('id', id)
    .single()
  if (!league) notFound()

  const [{ data: sessions }, { data: myReg }, { data: myAttendance }] = await Promise.all([
    supabase.from('league_sessions').select('id, session_date, session_number, status, notes').eq('league_id', id).order('session_date', { ascending: true }),
    user ? supabase.from('league_registrations').select('status, is_co_admin').eq('league_id', id).eq('user_id', user.id).single() : Promise.resolve({ data: null }),
    user ? supabase.from('league_session_attendance').select('league_session_id, attendance_status').eq('user_id', user.id) : Promise.resolve({ data: [] }),
  ])

  const isManager = user?.id === league.created_by
  const isCoAdmin = !isManager && (myReg as { is_co_admin?: boolean } | null)?.is_co_admin === true
  // Managers run/manage the schedule from the overview + Run Session, not this tab.
  if (isManager || isCoAdmin) redirect(`/leagues/${id}`)

  const attendanceMap = Object.fromEntries(
    ((myAttendance ?? []) as { league_session_id: string; attendance_status: string }[])
      .map((a) => [a.league_session_id, a.attendance_status]),
  )
  const sessionIds = ((sessions ?? []) as { id: string }[]).map((s) => s.id)
  const { data: viewableRounds } = sessionIds.length > 0
    ? await supabase.from('league_rounds').select('session_id').in('session_id', sessionIds).in('status', ['locked', 'completed'])
    : { data: [] as { session_id: string }[] }
  const sessionsWithSchedule = [...new Set(((viewableRounds ?? []) as { session_id: string }[]).map((r) => r.session_id))]

  // The viewer's active unified sub requests (open/filled) per session, so each card can show the
  // requester status line ("Looking for a sub…" / "Sub confirmed: X") on load.
  let subRequestBySession: Record<string, { id: string; status: 'open' | 'filled' | 'cancelled' | 'expired'; fulfillment_mode: 'open_pool' | 'self_assigned' | 'organizer_assigned'; subName: string | null }> = {}
  if (user && sessionIds.length > 0) {
    const adminDb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: reqs } = await adminDb
      .from('league_sub_requests')
      .select('id, league_session_id, status, fulfillment_mode, filled_by:profiles!filled_by_user_id(name)')
      .eq('requesting_player_id', user.id)
      .in('status', ['open', 'filled'])
      .in('league_session_id', sessionIds)
      .order('created_at', { ascending: false })
    for (const r of (reqs ?? []) as any[]) {
      const sid = r.league_session_id as string
      if (sid && !subRequestBySession[sid]) {
        subRequestBySession[sid] = { id: r.id, status: r.status, fulfillment_mode: r.fulfillment_mode, subName: (r.filled_by as any)?.name ?? null }
      }
    }
  }

  const navItems = leagueNavItems(id, { canManage: false, formatKind: league.format_kind })
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const imminentSession = ((sessions ?? []) as { session_date: string; status: string }[])
    .some((s) => s.session_date === todayStr || s.status === 'in_progress')

  // Live "who's coming" for the next (today or upcoming) session — every
  // registered player + their attendance, streamed via realtime.
  const ordered = ((sessions ?? []) as { id: string; session_date: string; session_number: number; status: string }[])
    .slice()
    .sort((a, b) => (a.session_date < b.session_date ? -1 : a.session_date > b.session_date ? 1 : 0))
  const nextSession = ordered.find((s) => s.session_date >= todayStr) ?? null

  let whoPlayers: { id: string; name: string }[] = []
  let whoAttendance: Record<string, string> = {}
  if (nextSession) {
    const [{ data: regs }, { data: att }] = await Promise.all([
      supabase.from('league_registrations').select('user_id, profile:profiles!user_id(name)').eq('league_id', id).eq('status', 'registered'),
      supabase.from('league_session_attendance').select('user_id, attendance_status').eq('league_session_id', nextSession.id),
    ])
    whoPlayers = ((regs ?? []) as any[]).map((r) => {
      const prof = Array.isArray(r.profile) ? r.profile[0] : r.profile
      return { id: r.user_id as string, name: (prof?.name as string) ?? 'Player' }
    })
    whoAttendance = Object.fromEntries(((att ?? []) as { user_id: string; attendance_status: string }[]).map((a) => [a.user_id, a.attendance_status]))
  }

  return (
    <DesktopShell
      header={
        <div className="flex items-center gap-3">
          <Link href={`/leagues/${id}`} className="text-brand-muted text-sm">← {league.name}</Link>
          <span className="text-brand-muted text-sm">/</span>
          <span className="text-sm font-medium text-brand-dark">Schedule</span>
        </div>
      }
      sidebar={<ManageNav items={navItems} />}
    >
      <ManageNav items={navItems} mobileOnly />
      <AutoRefresh intervalMs={imminentSession ? 20000 : 0} />
      <div className="space-y-4 pb-8 max-w-2xl">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-heading text-xl font-bold text-brand-dark">Schedule</h1>
          <RefreshButton className="shrink-0" />
        </div>
        <PlayerSchedule
          leagueId={id}
          sessions={(sessions ?? []) as any}
          attendanceMap={attendanceMap}
          sessionsWithSchedule={sessionsWithSchedule}
          isRegistered={(myReg as { status?: string } | null)?.status === 'registered'}
          leagueSkillLevel={skillRangeToLevel(league.skill_min, league.skill_max)}
          currentUserId={user?.id}
          subRequestBySession={subRequestBySession}
        />
        {nextSession && whoPlayers.length > 0 && (
          <WhoIsComing
            sessionId={nextSession.id}
            sessionLabel={`Session ${nextSession.session_number} — ${formatSessionDate(nextSession.session_date)}`}
            players={whoPlayers}
            initialAttendance={whoAttendance}
            currentUserId={user?.id ?? null}
          />
        )}
      </div>
    </DesktopShell>
  )
}
