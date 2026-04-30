import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

type Params = { params: { sessionId: string } }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Maps player self-reported status → organizer actual_status
const ACTUAL_STATUS_MAP: Record<string, string> = {
  checked_in_present: 'present',
  planning_to_attend: 'present',
  running_late:       'late',
  cannot_attend:      'not_present',
  not_responded:      'not_present',
}

// GET — all attendance records for this session
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('league_session_attendance')
    .select('id, user_id, attendance_status, checked_in_at, updated_at, notes')
    .eq('league_session_id', params.sessionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST — upsert own attendance (player self check-in)
// Body: { attendance_status, notes? }
// Organizer override: body also includes { user_id } — validated against league.created_by
export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { attendance_status, notes, user_id: targetUserId } = body

  const validStatuses = ['planning_to_attend', 'cannot_attend', 'checked_in_present', 'running_late', 'not_responded']
  if (!validStatuses.includes(attendance_status)) {
    return NextResponse.json({ error: 'Invalid attendance_status' }, { status: 400 })
  }

  // If targeting another user, verify caller is league organizer
  let effectiveUserId = user.id
  const db = admin()
  if (targetUserId && targetUserId !== user.id) {
    const { data: session } = await db
      .from('league_sessions')
      .select('league_id')
      .eq('id', params.sessionId)
      .single()
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    const { data: league } = await db
      .from('leagues')
      .select('created_by')
      .eq('id', session.league_id)
      .single()
    if (!league || league.created_by !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    effectiveUserId = targetUserId
  }

  const now = new Date().toISOString()
  const { data, error } = await db
    .from('league_session_attendance')
    .upsert({
      league_session_id:   params.sessionId,
      user_id:             effectiveUserId,
      attendance_status,
      notes:               notes ?? null,
      updated_at:          now,
      updated_by_user_id:  user.id,
      ...(attendance_status === 'checked_in_present' ? { checked_in_at: now } : {}),
    }, { onConflict: 'league_session_id,user_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Sync to organizer's attendance view in league_session_players
  const mappedStatus = ACTUAL_STATUS_MAP[attendance_status]
  if (mappedStatus) {
    await db
      .from('league_session_players')
      .update({ actual_status: mappedStatus })
      .eq('session_id', params.sessionId)
      .eq('user_id', effectiveUserId)
  }

  return NextResponse.json(data)
}
