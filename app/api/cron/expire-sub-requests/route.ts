export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { createNotifications, type NotificationInput } from '@/lib/notifications/create'
import { broadcastSubRequestsChanged } from '@/lib/subs/broadcast'

// Substitute-request expiration — canonical status cleanup (CRON_SECRET-guarded, daily). Stale/started
// OPEN requests → 'expired' via the idempotent, race-safe expire_sub_requests RPC (conditional
// status=open transition, FOR UPDATE SKIP LOCKED — a just-filled request is never overwritten). The
// /subs + Home loaders and the accept RPC independently reject stale requests between runs, so this
// worker is cleanup, not correctness enforcement. Notifies each just-expired request's requester once.
export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const runStart = new Date().toISOString()

  // Bounded batches until drained (cap the loop as a backstop).
  let expired = 0
  for (let i = 0; i < 20; i++) {
    const { data } = await db.rpc('expire_sub_requests', { p_limit: 200 })
    const n = (data as any)?.expired ?? 0
    expired += n
    if (n < 200) break
  }

  if (expired > 0) {
    await broadcastSubRequestsChanged()
    // Notify the requester of each request that expired THIS run (the audit row is written once per
    // expiry inside the RPC, so this is naturally deduped across runs).
    const { data: rows } = await db
      .from('audit_log')
      .select('entity_id, after')
      .eq('action', 'sub_request_expired')
      .gte('created_at', runStart)
      .limit(500)
    const notifs: NotificationInput[] = []
    for (const row of (rows ?? []) as any[]) {
      const requesterId = row.after?.requesting_player_id as string | undefined
      const leagueId = row.after?.league_id as string | undefined
      if (requesterId && leagueId) {
        notifs.push({
          recipientId: requesterId, surface: 'league', surfaceId: leagueId, kind: 'league_sub_expired',
          title: 'No substitute was found', body: 'Your substitute request has closed. You can contact your organizer if you still need help.',
          url: `/leagues/${leagueId}`,
        })
      }
    }
    if (notifs.length) await createNotifications(notifs)
  }

  return NextResponse.json({ ok: true, expired })
}
