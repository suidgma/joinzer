import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import { leagueNavItems } from '@/lib/leagues/leagueNav'
import { skillRangeToLevel } from '@/lib/taxonomy/formats'
import PlayerSchedule from '../PlayerSchedule'
import AutoRefresh from '@/components/ui/AutoRefresh'

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

  const navItems = leagueNavItems(id, { canManage: false, formatKind: league.format_kind })
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const imminentSession = ((sessions ?? []) as { session_date: string; status: string }[])
    .some((s) => s.session_date === todayStr || s.status === 'in_progress')

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
        <h1 className="font-heading text-xl font-bold text-brand-dark">Schedule</h1>
        <PlayerSchedule
          leagueId={id}
          sessions={(sessions ?? []) as any}
          attendanceMap={attendanceMap}
          sessionsWithSchedule={sessionsWithSchedule}
          isRegistered={(myReg as { status?: string } | null)?.status === 'registered'}
          leagueSkillLevel={skillRangeToLevel(league.skill_min, league.skill_max)}
        />
      </div>
    </DesktopShell>
  )
}
