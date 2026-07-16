import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { broadcast } from '@/lib/realtime/serverBroadcast'
import { attendanceTopic, RealtimeEvents } from '@/lib/realtime/topics'
import { createNotification } from '@/lib/notifications/create'
import { canOperateSession } from '@/lib/leagues/canOperateSession'

type Params = { params: Promise<{ sessionId: string; playerId: string }> }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Organizer's live `actual_status` → the player-facing self-report status, so an organizer
// change shows up in "Who's coming" exactly like a self check-in (the reverse of the self route's
// attendance → actual_status sync).
const ACTUAL_TO_ATTENDANCE: Record<string, string> = {
  present:       'checked_in_present',
  coming:        'planning_to_attend',
  late:          'running_late',
  cannot_attend: 'cannot_attend',
  not_present:   'not_responded',
}

// PATCH /api/league-sessions/[sessionId]/players/[playerId]
// Update actual_status / expected_status / notes / arrived_after_round. Organizer or co-admin only.
// A status change is mirrored to the player-facing attendance row + broadcast, so the player's
// "Who's coming" updates live (and they get a heads-up when checked in).
export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()

  // ── Authorize: only this league's organizer or a co-admin may change a player's status ──
  const { data: session } = await db
    .from('league_sessions')
    .select('league_id')
    .eq('id', params.sessionId)
    .single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const { data: league } = await db
    .from('leagues')
    .select('created_by, name')
    .eq('id', session.league_id)
    .single()
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  // Owner, co-admin, or (player-run leagues) the effective session host may change a player's status.
  if (!(await canOperateSession(db, params.sessionId, user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()

  const allowed = ['actual_status', 'expected_status', 'notes', 'arrived_after_round', 'player_type']
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key]
  }

  const { data, error } = await db
    .from('league_session_players')
    .update(update)
    .eq('id', params.playerId)
    .eq('session_id', params.sessionId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // ── Mirror an organizer status change to the player's side (live) ──
  if (body.actual_status !== undefined && data?.user_id) {
    const attendanceStatus = ACTUAL_TO_ATTENDANCE[body.actual_status as string]
    if (attendanceStatus) {
      const targetUserId = data.user_id as string
      const now = new Date().toISOString()

      // Persist to the self-report table so "Who's coming" is consistent on reload — mirrors the
      // self check-in route, which syncs the other way.
      await db.from('league_session_attendance').upsert({
        league_session_id:  params.sessionId,
        user_id:            targetUserId,
        attendance_status:  attendanceStatus,
        updated_at:         now,
        updated_by_user_id: user.id,
        ...(attendanceStatus === 'checked_in_present' ? { checked_in_at: now } : {}),
      }, { onConflict: 'league_session_id,user_id' })

      // Live push to everyone viewing "Who's coming" — the player's chip updates in real time.
      await broadcast(attendanceTopic(params.sessionId), RealtimeEvents.attendanceStatusChanged, {
        userId: targetUserId,
        status: attendanceStatus,
      })

      // Heads-up to the player when an organizer checks them in — the meaningful "you're in"
      // moment. Skipped for the organizer's own row and for other transitions to avoid noise.
      if (targetUserId !== user.id && body.actual_status === 'present') {
        await createNotification({
          recipientId: targetUserId,
          surface: 'league',
          surfaceId: session.league_id,
          kind: 'attendance_checked_in',
          title: "You're checked in",
          body: `An organizer marked you as here for ${league.name} tonight.`,
          url: `/leagues/${session.league_id}`,
        })
      }
    }
  }

  return NextResponse.json(data)
}
