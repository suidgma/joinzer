import { broadcast } from '@/lib/realtime/serverBroadcast'
import { subRequestsTopic, RealtimeEvents } from '@/lib/realtime/topics'
import { loadEligibleCandidatesForRequest, markNotified } from '@/lib/subs/candidates'
import { createNotifications } from '@/lib/notifications/create'

// Coarse "the open-request pool changed" signal — /subs + the Home Action Center refresh their
// server loaders on it. Best-effort; never blocks the write it accompanies.
export function broadcastSubRequestsChanged(): Promise<void> {
  return broadcast(subRequestsTopic(), RealtimeEvents.subRequestsChanged, {}).catch(() => {})
}

// Proactively notify the bounded top pool of OPTED-IN, eligible substitutes about a newly-opened
// request. Opt-in + eligibility + dedupe all live in loadEligibleCandidatesForRequest. Best-effort,
// post-commit — a notification failure must never affect the request that was created.
export async function notifyEligibleSubs(
  requestId: string,
  ctx: { leagueId: string; leagueName: string; dateLabel?: string | null; excludeUserId?: string },
): Promise<void> {
  try {
    const { generation, candidates } = await loadEligibleCandidatesForRequest(requestId, { limit: 15, excludeUserId: ctx.excludeUserId })
    if (candidates.length === 0) return
    await createNotifications(candidates.map((c) => ({
      recipientId: c.userId,
      surface: 'league' as const,
      surfaceId: ctx.leagueId,
      kind: 'sub_opportunity',
      title: `Sub needed — ${ctx.leagueName}`,
      body: ctx.dateLabel ? `${ctx.dateLabel} needs a substitute. Tap to sub in.` : 'A session needs a substitute. Tap to sub in.',
      url: `/subs/${requestId}`,
    })))
    await markNotified(requestId, candidates.map((c) => c.userId), generation)
  } catch (err) {
    console.error('[subs] proactive notify failed:', err)
  }
}
