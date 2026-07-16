import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { createNotification } from '@/lib/notifications/create'
import { broadcast } from '@/lib/realtime/serverBroadcast'
import { attendanceTopic, RealtimeEvents } from '@/lib/realtime/topics'
import { broadcastSubRequestsChanged } from '@/lib/subs/broadcast'
import { LIFECYCLE_STATUS, lifecycleMessage } from '@/lib/subs/lifecycleErrors'

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/league-sub-requests/[id]/reclaim — the requester takes their spot back before the
// occasion starts ("I can attend after all"). Atomic reverse + cancel in reclaim_sub_request.
export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: result, error } = await db.rpc('reclaim_sub_request', { p_request_id: id, p_user_id: user.id })
  if (error) {
    const code = (error.message ?? '').trim()
    const status = LIFECYCLE_STATUS[code] ?? 500
    return NextResponse.json({ error: lifecycleMessage(code, status), code }, { status })
  }

  fireReclaimSideEffects(db, user.id, result).catch(console.error)
  return NextResponse.json({ ok: true, ...(result as Record<string, unknown>) })
}

async function fireReclaimSideEffects(db: ReturnType<typeof admin>, requesterId: string, result: unknown) {
  const r = (result ?? {}) as { request_id?: string; league_id?: string; removed_sub?: string; session_id?: string | null; period_id?: string | null; idempotent?: boolean }
  if (r.idempotent || !r.request_id || !r.league_id) return

  const occasionId = r.session_id ?? r.period_id
  if (occasionId) await broadcast(attendanceTopic(occasionId), RealtimeEvents.attendanceStatusChanged, { userId: requesterId, status: 'coming' }).catch(() => {})
  await broadcastSubRequestsChanged()

  const [{ data: league }, { data: requester }] = await Promise.all([
    db.from('leagues').select('name, created_by').eq('id', r.league_id).maybeSingle(),
    db.from('profiles').select('name').eq('id', requesterId).maybeSingle(),
  ])
  const leagueName = league?.name ?? 'the league'
  const requesterName = requester?.name ?? 'The player'
  const url = `/leagues/${r.league_id}`

  if (r.removed_sub) {
    await createNotification({ recipientId: r.removed_sub, surface: 'league', surfaceId: r.league_id, kind: 'league_sub_reclaimed',
      title: `No longer needed — ${leagueName}`, body: `${requesterName} can attend after all, so you're no longer subbing. Thanks for stepping up!`, url })
  }
  if (league?.created_by && league.created_by !== requesterId) {
    await createNotification({ recipientId: league.created_by, surface: 'league', surfaceId: r.league_id, kind: 'league_sub_reclaimed',
      title: `Player reclaimed their spot — ${leagueName}`, body: `${requesterName} is attending after all; the substitute was removed.`, url })
  }
}
