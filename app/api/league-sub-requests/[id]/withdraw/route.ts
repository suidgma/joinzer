import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { createNotification } from '@/lib/notifications/create'
import { broadcast } from '@/lib/realtime/serverBroadcast'
import { attendanceTopic, RealtimeEvents } from '@/lib/realtime/topics'
import { broadcastSubRequestsChanged, notifyEligibleSubs } from '@/lib/subs/broadcast'
import { LIFECYCLE_STATUS, lifecycleMessage } from '@/lib/subs/lifecycleErrors'

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/league-sub-requests/[id]/withdraw — the filled substitute withdraws before the occasion
// starts. Atomic reverse + reopen happens in withdraw_sub_request; the route is the trust boundary
// (passes getUser().id — the RPC verifies it is the current substitute).
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: result, error } = await db.rpc('withdraw_sub_request', { p_request_id: id, p_user_id: user.id })
  if (error) {
    const code = (error.message ?? '').trim()
    const status = LIFECYCLE_STATUS[code] ?? 500
    return NextResponse.json({ error: lifecycleMessage(code, status), code }, { status })
  }

  fireWithdrawSideEffects(db, user.id, result).catch(console.error)
  return NextResponse.json({ ok: true, ...(result as Record<string, unknown>) })
}

async function fireWithdrawSideEffects(db: ReturnType<typeof admin>, withdrawerId: string, result: unknown) {
  const r = (result ?? {}) as { request_id?: string; league_id?: string; session_id?: string | null; period_id?: string | null }
  if (!r.request_id || !r.league_id) return

  const occasionId = r.session_id ?? r.period_id
  if (occasionId) await broadcast(attendanceTopic(occasionId), RealtimeEvents.attendanceStatusChanged, { userId: withdrawerId, status: 'not_present' }).catch(() => {})
  await broadcastSubRequestsChanged()

  const [{ data: req }, { data: league }, { data: withdrawer }] = await Promise.all([
    db.from('league_sub_requests').select('requesting_player_id, league_session_id').eq('id', r.request_id).maybeSingle(),
    db.from('leagues').select('name, created_by').eq('id', r.league_id).maybeSingle(),
    db.from('profiles').select('name').eq('id', withdrawerId).maybeSingle(),
  ])
  const leagueName = league?.name ?? 'your league'
  const withdrawerName = withdrawer?.name ?? 'Your substitute'
  const requesterId = (req as any)?.requesting_player_id as string | undefined
  const url = `/leagues/${r.league_id}`

  if (requesterId) {
    await createNotification({ recipientId: requesterId, surface: 'league', surfaceId: r.league_id, kind: 'league_sub_withdrew',
      title: `Your substitute withdrew — ${leagueName}`, body: `${withdrawerName} can no longer cover. We've reopened the request.`, url })
  }
  if (league?.created_by && league.created_by !== withdrawerId) {
    await createNotification({ recipientId: league.created_by, surface: 'league', surfaceId: r.league_id, kind: 'league_sub_withdrew',
      title: `Substitute withdrew — ${leagueName}`, body: `${withdrawerName} withdrew; the request is open again.`, url })
  }
  // Reopen wave to eligible opted-in candidates — EXCLUDING the withdrawing substitute.
  const dateLabel = (req as any)?.league_session_id
    ? await sessionDateLabel(db, (req as any).league_session_id)
    : null
  await notifyEligibleSubs(r.request_id, { leagueId: r.league_id, leagueName, dateLabel, excludeUserId: withdrawerId })
}

async function sessionDateLabel(db: ReturnType<typeof admin>, sessionId: string): Promise<string | null> {
  const { data } = await db.from('league_sessions').select('session_date').eq('id', sessionId).maybeSingle()
  const d = (data as any)?.session_date
  return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric' }) : null
}
