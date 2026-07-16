import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { createNotification } from '@/lib/notifications/create'
import { broadcast } from '@/lib/realtime/serverBroadcast'
import { attendanceTopic, RealtimeEvents } from '@/lib/realtime/topics'
import { broadcastSubRequestsChanged, notifyEligibleSubs } from '@/lib/subs/broadcast'

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// GET — list sub requests (filter by ?sessionId or ?leagueId)
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')
  const leagueId  = searchParams.get('leagueId')

  let query = supabase
    .from('league_sub_requests')
    .select(`
      id, league_id, league_session_id, league_period_id, status, notes, created_at,
      fulfillment_mode, requested_skill_level, division_type,
      requesting_player:profiles!requesting_player_id(name),
      filled_by:profiles!filled_by_user_id(name),
      session:league_sessions!league_session_id(session_date, session_number),
      league:leagues!league_id(name)
    `)
    .order('created_at', { ascending: false })

  if (sessionId) query = query.eq('league_session_id', sessionId)
  if (leagueId)  query = query.eq('league_id', leagueId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST — the requester creates a substitute request for THEMSELVES (Phase 3).
// Body: { league_id, league_session_id? | league_period_id?, fulfillment_mode?, chosen_user_id?, note? }
//   fulfillment_mode: 'open_pool' (default — "Find me a sub") | 'self_assigned' ("I already have someone").
// requesting_player_id is ALWAYS forced to the authenticated user — never trusted from the client.
// All derivation + validation + (for self_assigned) atomic placement happen in create_player_sub_request.
const STATUS: Record<string, number> = {
  bad_request: 400, chosen_is_self: 400,
  league_not_found: 404, covered_player_not_found: 404, covered_not_found: 404, request_not_found: 404, accepter_not_found: 404,
  not_registered: 403, requester_ineligible: 403, accepter_ineligible: 403, own_request: 403, gender_mismatch: 403,
  unsupported_format: 422, invalid_scope: 422, scope_mismatch: 422,
  already_open: 409, already_filled: 409, duplicate_participation: 409, already_covered: 409, schedule_conflict: 409, generation_started: 409,
  request_expired: 410, occasion_started: 410,
}
const MESSAGE: Record<string, string> = {
  already_open: 'You already have an active substitute request for this session.',
  already_filled: 'You already have a substitute for this session.',
  not_registered: 'You must be registered for this league to request a sub.',
  occasion_started: 'This session has already started.',
  generation_started: 'Substitutes can no longer be changed because play has already been generated.',
  unsupported_format: "This league format doesn't support substitute requests yet.",
  chosen_is_self: "You can't pick yourself as your own substitute.",
  // self_assigned: the chosen player failed a hard gate
  duplicate_participation: "That player is already in this session.",
  already_covered: 'This spot already has a substitute.',
  schedule_conflict: 'That player already has another Joinzer commitment that day.',
  gender_mismatch: "That player's profile doesn't match this session's format.",
  accepter_ineligible: 'That player needs to finish setting up their profile first.',
  own_request: "You can't pick yourself as your own substitute.",
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const leagueId = typeof body.league_id === 'string' ? body.league_id : ''
  const sessionId = typeof body.league_session_id === 'string' ? body.league_session_id : ''
  const periodId = typeof body.league_period_id === 'string' ? body.league_period_id : ''
  const mode = body.fulfillment_mode === 'self_assigned' ? 'self_assigned' : 'open_pool'
  const chosenUserId = typeof body.chosen_user_id === 'string' ? body.chosen_user_id : null
  const note = typeof body.note === 'string' ? body.note.slice(0, 300) : null

  if (!leagueId || (!sessionId && !periodId)) {
    return NextResponse.json({ error: 'league_id and a session or period are required' }, { status: 400 })
  }
  const scopeKind = sessionId ? 'session' : 'period'
  const scopeId = sessionId || periodId

  const db = admin()
  const { data: result, error } = await db.rpc('create_player_sub_request', {
    p_requester_id: user.id,
    p_league_id: leagueId,
    p_scope_kind: scopeKind,
    p_scope_id: scopeId,
    p_fulfillment_mode: mode,
    p_chosen_user_id: mode === 'self_assigned' ? chosenUserId : null,
    p_note: note,
  })

  if (error) {
    const code = (error.message ?? '').trim()
    const status = STATUS[code] ?? 500
    const message = MESSAGE[code] ?? (status === 500 ? 'Could not create the substitute request.' : code)
    return NextResponse.json({ error: message, code }, { status })
  }

  // Best-effort side effects — never roll back a committed request/placement.
  fireSideEffects(user.id, leagueId, scopeKind, scopeId, result).catch(console.error)

  return NextResponse.json({ ok: true, ...(result as Record<string, unknown>) }, { status: 201 })
}

async function fireSideEffects(
  requesterId: string,
  leagueId: string,
  scopeKind: string,
  scopeId: string,
  result: unknown,
) {
  const r = (result ?? {}) as { fulfillment_mode?: string; filled_by_user_id?: string; request_id?: string }
  const db = admin()

  const [{ data: league }, { data: requester }] = await Promise.all([
    db.from('leagues').select('name, created_by').eq('id', leagueId).maybeSingle(),
    db.from('profiles').select('name').eq('id', requesterId).maybeSingle(),
  ])
  const leagueName = league?.name ?? 'your league'
  const requesterName = requester?.name ?? 'A player'
  const url = `/leagues/${leagueId}`

  // Live attendance nudge (occasion topic) + the discovery-pool "changed" signal (/subs + Home).
  await broadcast(attendanceTopic(scopeId), RealtimeEvents.attendanceStatusChanged, { userId: requesterId, status: 'cannot_attend' }).catch(() => {})
  await broadcastSubRequestsChanged()

  if (r.fulfillment_mode === 'self_assigned' && r.filled_by_user_id) {
    const { data: sub } = await db.from('profiles').select('name').eq('id', r.filled_by_user_id).maybeSingle()
    await createNotification({
      recipientId: r.filled_by_user_id, surface: 'league', surfaceId: leagueId, kind: 'league_sub_confirmed',
      title: `You're subbing in — ${leagueName}`, body: `Covering for ${requesterName}`, url,
    })
    if (league?.created_by && league.created_by !== requesterId) {
      await createNotification({
        recipientId: league.created_by, surface: 'league', surfaceId: leagueId, kind: 'league_sub_filled',
        title: `Sub filled — ${leagueName}`, body: `${requesterName} lined up ${sub?.name ?? 'a substitute'}`, url,
      })
    }
    return
  }

  // open_pool: let the organizer observe the request, then proactively notify the top opted-in
  // eligible substitutes (opt-in + eligibility + dedupe all enforced inside notifyEligibleSubs).
  if (league?.created_by && league.created_by !== requesterId) {
    await createNotification({
      recipientId: league.created_by, surface: 'league', surfaceId: leagueId, kind: 'league_sub_request',
      title: `Sub needed — ${leagueName}`, body: `${requesterName} is looking for a substitute.`, url,
    })
  }
  const r2 = (result ?? {}) as { request_id?: string; scope?: string }
  if (r2.request_id) {
    const { data: sess } = r2.scope === 'session'
      ? await db.from('league_sessions').select('session_date').eq('id', scopeId).maybeSingle()
      : { data: null }
    const dateLabel = (sess as any)?.session_date
      ? new Date((sess as any).session_date + 'T00:00:00').toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' })
      : null
    await notifyEligibleSubs(r2.request_id, { leagueId, leagueName, dateLabel })
  }
}
