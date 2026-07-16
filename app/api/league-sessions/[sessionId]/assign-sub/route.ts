import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { canOperateSession } from '@/lib/leagues/canOperateSession'

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST — organizer assigns a sub to cover an absent roster player (round-robin), through the
// unified model: assign_organizer_sub_request creates/reuses an 'organizer_assigned' filled
// league_sub_requests record AND places the sub via the shared primitive in one transaction.
// Body: { subUserId, absentPlayerId, override? }
//   subUserId      — profiles.id of the substitute
//   absentPlayerId — league_session_players.id of the absent roster player
//   override       — organizer confirmed a permitted SOFT (rating/logistical) override
const STATUS: Record<string, number> = {
  bad_request: 400, league_not_found: 404, covered_player_not_found: 404, accepter_not_found: 404,
  own_request: 403, accepter_ineligible: 403, gender_mismatch: 403,
  unsupported_format: 422, scope_mismatch: 422, already_covered: 409,
}

export async function POST(req: NextRequest, props: { params: Promise<{ sessionId: string }> }) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { subUserId, absentPlayerId } = body as { subUserId?: string; absentPlayerId?: string }
  const override = body.override === true
  if (!subUserId || !absentPlayerId) {
    return NextResponse.json({ error: 'subUserId and absentPlayerId are required' }, { status: 400 })
  }

  const db = admin()

  const { data: session } = await db
    .from('league_sessions')
    .select('id, league_id')
    .eq('id', params.sessionId)
    .single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  if (!(await canOperateSession(db, params.sessionId, user.id))) {
    return NextResponse.json({ error: 'Not authorized to assign subs' }, { status: 403 })
  }

  // The covered player's user id comes from the absent roster row (never trusted from the client).
  const { data: absent } = await db
    .from('league_session_players')
    .select('id, user_id')
    .eq('id', absentPlayerId)
    .eq('session_id', params.sessionId)
    .single()
  if (!absent || !absent.user_id) {
    return NextResponse.json({ error: 'Absent player not found in this session' }, { status: 404 })
  }

  const { data: result, error } = await db.rpc('assign_organizer_sub_request', {
    p_actor_id: user.id,
    p_league_id: session.league_id,
    p_scope_kind: 'session',
    p_scope_id: params.sessionId,
    p_covered_user_id: absent.user_id,
    p_covered_session_player_id: absentPlayerId,
    p_sub_user_id: subUserId,
    p_placed_with_override: override,
  })

  if (error) {
    const code = (error.message ?? '').trim()
    const status = STATUS[code] ?? 500
    return NextResponse.json({ error: status === 500 ? (error.message ?? 'Could not assign the sub') : code, code }, { status })
  }

  const r = result as { placement?: { sub_session_player_id?: string } }
  return NextResponse.json({ ok: true, subPlayerId: r.placement?.sub_session_player_id, ...(result as Record<string, unknown>) })
}
