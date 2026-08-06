export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { createNotifications, type NotificationInput } from '@/lib/notifications/create'
import { broadcastSubRequestsChanged } from '@/lib/subs/broadcast'
import { assertCronSecret } from '@/lib/cron/auth'
import {
  type WarnableRequest,
  WARNING_WINDOW_HOURS,
  shouldWarn,
  wasWarned,
  warningRecipients,
  warningBody,
} from '@/lib/subs/unfilledWarning'

// Daily substitute-request sweep (CRON_SECRET-guarded). Runs 0 11 * * * UTC = 3am PDT / 4am PST,
// which is the morning OF that evening's sessions. Two passes, in this order:
//
//   1. WARN — open session-scoped requests starting within the next 24h that still have nobody.
//      This runs FIRST and deliberately warns requests this run will not expire: the point is to
//      reach the requester and organizer while they can still act, roughly 15 hours out.
//   2. EXPIRE — canonical status cleanup for stale/started open requests, via the idempotent,
//      race-safe expire_sub_requests RPC (conditional status=open transition, FOR UPDATE SKIP
//      LOCKED, so a just-filled request is never overwritten). The /subs + Home loaders and the
//      accept RPC independently reject stale requests between runs, so this is cleanup, not
//      correctness enforcement.
//
// The post-expiry "No substitute was found" notice fires only for requests that were never warned
// (period-scoped ones, which have no clock, and same-day creations that missed this run). One
// notification per dead request — and where possible it is the early, actionable one.
// Matches the house pattern in the other sub-request routes: a local factory so the client's
// inferred generics survive into helper signatures (ReturnType<typeof createAdmin> loses them).
function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(req: NextRequest) {
  const unauthorized = assertCronSecret(req, 'expire-sub-requests')
  if (unauthorized) return unauthorized
  const db = admin()
  const runStart = new Date().toISOString()
  const now = new Date()

  const warned = await warnUnfilled(db, now)

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

    // Suppress the post-hoc notice for anything already warned — otherwise one dead request
    // produces two notifications, the second of which arrives after the game.
    const ids = [...new Set((rows ?? []).map((r: any) => r.entity_id as string).filter(Boolean))]
    const alreadyWarned = new Set<string>()
    if (ids.length) {
      const { data: reqs } = await db
        .from('league_sub_requests')
        .select('id, notification_generation, unfilled_warned_generation')
        .in('id', ids)
      for (const r of (reqs ?? []) as any[]) {
        if (wasWarned({
          notificationGeneration: r.notification_generation ?? 0,
          unfilledWarnedGeneration: r.unfilled_warned_generation ?? null,
        })) alreadyWarned.add(r.id)
      }
    }

    const notifs: NotificationInput[] = []
    for (const row of (rows ?? []) as any[]) {
      if (alreadyWarned.has(row.entity_id)) continue
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

  return NextResponse.json({ ok: true, expired, warned })
}

// Pass 1 — warn on still-unfilled requests whose session is close. Best-effort: a failure here must
// never stop the expiry sweep below, which is the correctness-relevant half of this route.
async function warnUnfilled(db: ReturnType<typeof admin>, now: Date): Promise<number> {
  try {
    const horizon = new Date(now.getTime() + WARNING_WINDOW_HOURS * 3600_000).toISOString()
    const { data, error } = await db
      .from('league_sub_requests')
      .select(`id, league_id, requesting_player_id, expires_at, notification_generation, unfilled_warned_generation,
        league_session_id,
        league:leagues!league_id(name, created_by),
        session:league_sessions!league_session_id(session_date, status)`)
      .eq('status', 'open')
      .not('expires_at', 'is', null)
      .gt('expires_at', now.toISOString())
      .lte('expires_at', horizon)
      .limit(500)
    if (error) { console.error('[subs] unfilled-warning scan failed:', error.message); return 0 }

    const rows = (data ?? []) as any[]
    if (rows.length === 0) return 0

    // Generation guard: a session with rounds already built has nothing actionable left.
    const sessionIds = [...new Set(rows.map((r) => r.league_session_id).filter(Boolean))]
    const generated = new Set<string>()
    if (sessionIds.length) {
      const { data: rounds } = await db.from('league_rounds').select('session_id').in('session_id', sessionIds)
      for (const x of (rounds ?? []) as any[]) generated.add(x.session_id)
    }

    const due: WarnableRequest[] = []
    for (const r of rows) {
      const league = Array.isArray(r.league) ? r.league[0] : r.league
      const session = Array.isArray(r.session) ? r.session[0] : r.session
      const candidate: WarnableRequest = {
        requestId: r.id,
        leagueId: r.league_id,
        leagueName: league?.name ?? 'your league',
        requesterId: r.requesting_player_id,
        organizerId: league?.created_by ?? null,
        sessionDate: session?.session_date ?? null,
        expiresAt: r.expires_at ?? null,
        sessionStatus: session?.status ?? null,
        generated: r.league_session_id ? generated.has(r.league_session_id) : false,
        notificationGeneration: r.notification_generation ?? 0,
        unfilledWarnedGeneration: r.unfilled_warned_generation ?? null,
      }
      if (shouldWarn(candidate, now)) due.push(candidate)
    }
    if (due.length === 0) return 0

    const notifs: NotificationInput[] = []
    for (const r of due) {
      const body = warningBody(r, now)
      for (const recipientId of warningRecipients(r)) {
        notifs.push({
          recipientId, surface: 'league', surfaceId: r.leagueId, kind: 'league_sub_unfilled_warning',
          title: `Still no substitute — ${r.leagueName}`,
          body: recipientId === r.requesterId
            ? `${body} Contact your organizer if you still need cover.`
            : body,
          url: `/subs/${r.requestId}`,
        })
      }
    }
    await createNotifications(notifs)

    // Stamp AFTER sending. If the send throws we never get here, so tomorrow's run retries rather
    // than silently swallowing the warning — the failure mode is a duplicate, not a miss.
    for (const r of due) {
      await db.from('league_sub_requests')
        .update({ unfilled_warned_generation: r.notificationGeneration })
        .eq('id', r.requestId)
        .eq('notification_generation', r.notificationGeneration)
    }
    return due.length
  } catch (err) {
    console.error('[subs] unfilled-warning pass failed:', err)
    return 0
  }
}
