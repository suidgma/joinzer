import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { canOperateSession } from '@/lib/leagues/canOperateSession'

type Params = { params: Promise<{ sessionId: string }> }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/league-sessions/[sessionId]/host — set who hosts THIS session (player-run leagues only).
// Body: { host_user_id: string | null }
//   • a uuid → claim (for yourself) or assign/hand-off (if you're an operator)
//   • null   → release the per-session host (reverts to the season host, or vacant)
//
// Two authorization paths:
//   • Operator (owner / co-admin / current effective host) — may set the host to any roster
//     player or release it. Covers hand-off and "the season host subs herself out tonight."
//   • Any roster player — may CLAIM an empty host seat for themselves only (single-writer,
//     race-safe). Blocked once anyone (incl. a season host) is the effective host.
export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const target: string | null = typeof body.host_user_id === 'string' ? body.host_user_id : null

  const db = admin()

  const { data: session } = await db
    .from('league_sessions')
    .select('id, league_id, host_user_id')
    .eq('id', params.sessionId)
    .single()
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const { data: league } = await db
    .from('leagues')
    .select('created_by, self_run, season_host_user_id')
    .eq('id', (session as { league_id: string }).league_id)
    .single()
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (!(league as { self_run: boolean }).self_run) {
    return NextResponse.json({ error: 'This league is not player-run.' }, { status: 400 })
  }

  const leagueId = (session as { league_id: string }).league_id
  const effectiveHost =
    (session as { host_user_id: string | null }).host_user_id ??
    (league as { season_host_user_id: string | null }).season_host_user_id

  // A non-null target must be a registered player on this league's roster.
  if (target) {
    const { data: reg } = await db
      .from('league_registrations')
      .select('user_id')
      .eq('league_id', leagueId)
      .eq('user_id', target)
      .eq('status', 'registered')
      .maybeSingle()
    if (!reg) return NextResponse.json({ error: 'That player is not on this league roster.' }, { status: 400 })
  }

  const isOperator = await canOperateSession(db, params.sessionId, user.id)

  if (!isOperator) {
    // Non-operators may only claim an empty seat for themselves.
    if (target !== user.id) {
      return NextResponse.json({ error: 'Only the current host or organizer can assign someone else.' }, { status: 403 })
    }
    if (effectiveHost) {
      return NextResponse.json({ error: 'Someone is already hosting this session.' }, { status: 409 })
    }
    // Race-safe claim: only succeeds while the seat is still vacant.
    const { data: claimed } = await db
      .from('league_sessions')
      .update({ host_user_id: user.id })
      .eq('id', params.sessionId)
      .is('host_user_id', null)
      .select('id')
    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ error: 'Someone just claimed hosting — refresh to see who.' }, { status: 409 })
    }
    return NextResponse.json({ host_user_id: user.id })
  }

  // Operator path: assign to a roster player, hand off, or release (null).
  const { error } = await db
    .from('league_sessions')
    .update({ host_user_id: target })
    .eq('id', params.sessionId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ host_user_id: target })
}
