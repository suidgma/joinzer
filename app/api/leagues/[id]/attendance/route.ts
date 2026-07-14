import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { authorizeOrganizer, ATTENDANCE_STATUSES } from '@/lib/leagues/attendanceWrite'
import { broadcast } from '@/lib/realtime/serverBroadcast'
import { attendanceTopic, RealtimeEvents } from '@/lib/realtime/topics'

type Params = { params: Promise<{ id: string }> }
function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/leagues/[id]/attendance
// Set an attendee's status. Update by attendanceId (subs/guests, which always have
// a row), else upsert by (periodId, registrationId) for a box member whose row may
// not exist yet. Organizer/co-admin only. Body:
//   { status, attendanceId } | { status, periodId, registrationId }
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { status, attendanceId, periodId, registrationId } = body
  if (!ATTENDANCE_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const db = admin()
  const authz = await authorizeOrganizer(db, params.id, user.id)
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status })

  const now = new Date().toISOString()

  // Live push to the organizer grid / co-admins viewing this period's attendance.
  const emitAttendance = (row: any) =>
    broadcast(attendanceTopic(row.period_id), RealtimeEvents.attendanceStatusChanged, {
      registrationId: row.registration_id ?? null,
      attendanceId: row.id,
      userId: row.user_id ?? null,
      status: row.status,
    })

  // When a covered member is marked back to present (any non-'has_sub' status),
  // un-assign their sub(s) so none linger and show in matches. For doubles a team
  // is one entrant with two slots (its own reg + the partner's), so clear covers on
  // both — otherwise a sub covering the partner slot would be orphaned.
  async function clearCoveringSubs(coveredRegId: string | null, forPeriodId: string | null) {
    if (status === 'has_sub' || !coveredRegId || !forPeriodId) return
    const { data: reg } = await db
      .from('league_registrations').select('partner_registration_id')
      .eq('id', coveredRegId).maybeSingle()
    const slotRegs = [coveredRegId, ...(reg?.partner_registration_id ? [reg.partner_registration_id] : [])]
    await db.from('league_attendance')
      .update({ subbing_for_registration_id: null, updated_at: now })
      .eq('league_id', params.id).eq('period_id', forPeriodId).in('subbing_for_registration_id', slotRegs)
  }

  if (attendanceId) {
    const { data, error } = await db
      .from('league_attendance')
      .update({ status, updated_at: now })
      .eq('id', attendanceId)
      .eq('league_id', params.id)
      .select()
      .single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 500 })
    await clearCoveringSubs((data as any).registration_id, (data as any).period_id)
    await emitAttendance(data)
    return NextResponse.json({ attendance: data })
  }

  if (!periodId || !registrationId) {
    return NextResponse.json({ error: 'Missing target' }, { status: 400 })
  }

  // Update-or-insert (the partial unique index makes ON CONFLICT awkward).
  const { data: existing } = await db
    .from('league_attendance')
    .select('id')
    .eq('period_id', periodId)
    .eq('registration_id', registrationId)
    .maybeSingle()

  if (existing) {
    const { data, error } = await db
      .from('league_attendance')
      .update({ status, updated_at: now })
      .eq('id', existing.id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await clearCoveringSubs(registrationId, periodId)
    await emitAttendance(data)
    return NextResponse.json({ attendance: data })
  }

  const { data: reg } = await db
    .from('league_registrations')
    .select('user_id, league_id')
    .eq('id', registrationId)
    .single()
  if (!reg || reg.league_id !== params.id) {
    return NextResponse.json({ error: 'Bad registration' }, { status: 400 })
  }

  const { data, error } = await db
    .from('league_attendance')
    .insert({ league_id: params.id, period_id: periodId, registration_id: registrationId, user_id: reg.user_id, status })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await emitAttendance(data)
  return NextResponse.json({ attendance: data })
}
