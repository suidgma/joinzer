import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { broadcast } from '@/lib/realtime/serverBroadcast'
import { attendanceTopic, RealtimeEvents } from '@/lib/realtime/topics'

// POST /api/leagues/[id]/attendance/self — a PLAYER self-reports their own attendance
// for the league's active period (box cycle or ladder session). Sets ONLY their own
// league_attendance row. Distinct from the organizer route, which can set anyone's.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const SELF_STATUSES = ['present', 'coming', 'late', 'cannot_attend']

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { status } = await req.json().catch(() => ({}))
  if (!SELF_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Bad status' }, { status: 400 })
  }

  const db = admin()

  const { data: reg } = await db
    .from('league_registrations')
    .select('id, status')
    .eq('league_id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!reg || reg.status !== 'registered') {
    return NextResponse.json({ error: 'Only a registered player can check in' }, { status: 403 })
  }

  const { data: period } = await db
    .from('league_periods')
    .select('id')
    .eq('league_id', id)
    .in('period_kind', ['cycle', 'ladder_session'])
    .eq('status', 'active')
    .order('period_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!period) return NextResponse.json({ error: 'No active session to check in for' }, { status: 400 })

  const { data: existing } = await db
    .from('league_attendance')
    .select('id, status')
    .eq('period_id', period.id)
    .eq('registration_id', reg.id)
    .maybeSingle()

  // If they've been subbed out, they must undo the sub before self-reporting again.
  if (existing?.status === 'has_sub') {
    return NextResponse.json({ error: 'You have a sub in — cancel it first' }, { status: 400 })
  }

  const now = new Date().toISOString()
  if (existing) {
    await db.from('league_attendance').update({ status, updated_at: now }).eq('id', existing.id)
  } else {
    await db.from('league_attendance').insert({ league_id: id, period_id: period.id, registration_id: reg.id, user_id: user.id, status })
  }

  // Live push to the organizer grid / anyone viewing this period's attendance.
  await broadcast(attendanceTopic(period.id), RealtimeEvents.attendanceStatusChanged, {
    registrationId: reg.id,
    userId: user.id,
    status,
  })

  return NextResponse.json({ ok: true })
}
