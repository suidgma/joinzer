import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { createNotification } from '@/lib/notifications/create'
import { broadcast } from '@/lib/realtime/serverBroadcast'
import { attendanceTopic, RealtimeEvents } from '@/lib/realtime/topics'
import { broadcastSubRequestsChanged, notifyEligibleSubs } from '@/lib/subs/broadcast'
import { LIFECYCLE_STATUS, lifecycleMessage } from '@/lib/subs/lifecycleErrors'
import { canOperateSession } from '@/lib/leagues/canOperateSession'
import { authorizeOrganizer } from '@/lib/leagues/attendanceWrite'

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/league-sub-requests/[id]/organizer-correct — organizer reopen | cancel | replace of a
// filled request, before start. Body: { mode, new_sub_user_id?, override? }. Authorization is
// re-derived server-side (session operator or league organizer); the RPC does the atomic work.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const mode = ['reopen', 'cancel', 'replace'].includes(body.mode) ? body.mode : null
  if (!mode) return NextResponse.json({ error: 'mode must be reopen, cancel, or replace' }, { status: 400 })
  const newSubUserId = typeof body.new_sub_user_id === 'string' ? body.new_sub_user_id : null
  const override = body.override === true

  const db = admin()

  // Re-derive the actor's operating authority for this request's occasion.
  const { data: reqRow } = await db.from('league_sub_requests').select('id, league_id, league_session_id').eq('id', id).maybeSingle()
  if (!reqRow) return NextResponse.json({ error: 'That request is no longer available.', code: 'request_not_found' }, { status: 404 })
  const sessionId = (reqRow as any).league_session_id as string | null
  const authorized = sessionId
    ? await canOperateSession(db, sessionId, user.id)
    : (await authorizeOrganizer(db, (reqRow as any).league_id, user.id)).ok
  if (!authorized) return NextResponse.json({ error: 'Not authorized to manage this request.', code: 'organizer_required' }, { status: 403 })

  const { data: result, error } = await db.rpc('organizer_correct_sub_request', {
    p_actor_id: user.id, p_request_id: id, p_mode: mode,
    p_new_sub_user_id: mode === 'replace' ? newSubUserId : null, p_placed_with_override: override,
  })
  if (error) {
    const code = (error.message ?? '').trim()
    const status = LIFECYCLE_STATUS[code] ?? 500
    return NextResponse.json({ error: lifecycleMessage(code, status), code }, { status })
  }

  fireOrganizerSideEffects(db, user.id, mode, result).catch(console.error)
  return NextResponse.json({ ok: true, ...(result as Record<string, unknown>) })
}

async function fireOrganizerSideEffects(db: ReturnType<typeof admin>, actorId: string, mode: string, result: unknown) {
  const r = (result ?? {}) as {
    request_id?: string; league_id?: string; removed_sub?: string; old_sub?: string; filled_by_user_id?: string
    session_id?: string | null; period_id?: string | null; idempotent?: boolean
  }
  if (r.idempotent || !r.request_id || !r.league_id) return

  const occasionId = r.session_id ?? r.period_id
  if (occasionId) await broadcast(attendanceTopic(occasionId), RealtimeEvents.attendanceStatusChanged, { userId: actorId, status: 'changed' }).catch(() => {})
  await broadcastSubRequestsChanged()

  const [{ data: reqR }, { data: league }] = await Promise.all([
    db.from('league_sub_requests').select('requesting_player_id, league_session_id').eq('id', r.request_id).maybeSingle(),
    db.from('leagues').select('name, created_by').eq('id', r.league_id).maybeSingle(),
  ])
  const leagueName = league?.name ?? 'the league'
  const requesterId = (reqR as any)?.requesting_player_id as string | undefined
  const url = `/leagues/${r.league_id}`

  if (mode === 'replace') {
    if (r.old_sub) await createNotification({ recipientId: r.old_sub, surface: 'league', surfaceId: r.league_id, kind: 'league_sub_replaced', title: `Substitute change — ${leagueName}`, body: 'The organizer assigned a different substitute for this session.', url })
    if (r.filled_by_user_id) await createNotification({ recipientId: r.filled_by_user_id, surface: 'league', surfaceId: r.league_id, kind: 'league_sub_confirmed', title: `You're subbing in — ${leagueName}`, body: 'The organizer assigned you as the substitute.', url })
    if (requesterId) await createNotification({ recipientId: requesterId, surface: 'league', surfaceId: r.league_id, kind: 'league_sub_confirmed', title: `Your substitute changed — ${leagueName}`, body: 'The organizer updated who is covering your spot.', url })
    return
  }

  // reopen / cancel — the assigned substitute was removed.
  if (r.removed_sub) await createNotification({ recipientId: r.removed_sub, surface: 'league', surfaceId: r.league_id, kind: 'league_sub_removed', title: `No longer subbing — ${leagueName}`, body: 'The organizer removed you from this substitute spot.', url })
  if (requesterId) await createNotification({ recipientId: requesterId, surface: 'league', surfaceId: r.league_id, kind: mode === 'cancel' ? 'league_sub_cancelled' : 'league_sub_request', title: mode === 'cancel' ? `Sub request closed — ${leagueName}` : `Still looking for a sub — ${leagueName}`, body: mode === 'cancel' ? 'The organizer closed this substitute request.' : 'The organizer reopened your request to the substitute pool.', url })

  if (mode === 'reopen') {
    const dateLabel = (reqR as any)?.league_session_id ? await sessionDateLabel(db, (reqR as any).league_session_id) : null
    await notifyEligibleSubs(r.request_id, { leagueId: r.league_id, leagueName, dateLabel, excludeUserId: r.removed_sub })
  }
}

async function sessionDateLabel(db: ReturnType<typeof admin>, sessionId: string): Promise<string | null> {
  const { data } = await db.from('league_sessions').select('session_date').eq('id', sessionId).maybeSingle()
  const d = (data as any)?.session_date
  return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' }) : null
}
