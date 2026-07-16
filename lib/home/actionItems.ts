// Home "Needs Your Attention" — a server-derived, typed ActionItem[] assembled from authoritative
// existing records (NO action-items table). Modest and practical: a discriminated union with room to
// add types later (unread_announcement, incomplete_payment, score_confirmation, waitlist_invitation,
// registration_deadline, schedule_change, rating_change) without reworking the shape.
// docs/phases/substitutions-implementation-plan.md §7.

import { createClient } from '@supabase/supabase-js'
import { loadOpenOpportunities } from '@/lib/subs/loadOpportunities'
import type { MatchedSubOpportunity } from '@/lib/subs/matching'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
const pacificToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

export type OwnOpenRequestItem = {
  requestId: string
  leagueId: string
  leagueName: string
  date: string | null
  sessionNumber: number | null
}
export type SubstituteFoundItem = {
  requestId: string
  leagueId: string
  leagueName: string
  subName: string | null
  byOrganizer: boolean
  date: string | null
}

export type ActionItem =
  | { type: 'own_open_sub_request'; id: string; priority: number; request: OwnOpenRequestItem }
  | { type: 'substitute_found'; id: string; priority: number; request: SubstituteFoundItem }
  | { type: 'matched_sub_opportunity'; id: string; priority: number; opportunity: MatchedSubOpportunity }

const MAX_ITEMS = 3
const MAX_MATCHED = 2

// Priority = lower sorts first. Ordering (documented):
//   1  own open request                    (your unresolved ask; near-start ⇒ smaller number)
//   3  substitute found (awareness)
//   5  matched opportunity starting soon    (rank folded in as a fractional tiebreak)
// Attendance-needed items are deferred (not composed here) — the union is ready for them.
export async function getHomeActionItems(userId: string): Promise<ActionItem[]> {
  const db = admin()
  const today = pacificToday()

  const [{ data: profile }, { data: myReqs }] = await Promise.all([
    db.from('profiles').select('open_to_subbing').eq('id', userId).maybeSingle(),
    db.from('league_sub_requests')
      .select(`id, status, fulfillment_mode, filled_at, league_id, league_session_id,
        league:leagues!league_id(name), session:league_sessions!league_session_id(session_date, session_number),
        filled_by:profiles!filled_by_user_id(name)`)
      .eq('requesting_player_id', userId)
      .in('status', ['open', 'filled'])
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const items: ActionItem[] = []

  for (const r of (myReqs ?? []) as any[]) {
    const league = Array.isArray(r.league) ? r.league[0] : r.league
    const session = Array.isArray(r.session) ? r.session[0] : r.session
    const date = session?.session_date ?? null
    if (r.status === 'open') {
      // Sooner occasion ⇒ higher priority (smaller number).
      const days = date ? daysFrom(today, date) : 99
      items.push({
        type: 'own_open_sub_request', id: `own-open-${r.id}`, priority: 1 + clamp01(days / 30),
        request: { requestId: r.id, leagueId: r.league_id, leagueName: league?.name ?? 'League', date, sessionNumber: session?.session_number ?? null },
      })
    } else if (r.status === 'filled') {
      // Age out stale confirmations: keep only if the occasion is upcoming, or it was filled recently.
      const recent = r.filled_at && (Date.now() - new Date(r.filled_at).getTime()) < 5 * 86400000
      const upcoming = !date || date >= today
      if (!recent && !upcoming) continue
      const filledBy = Array.isArray(r.filled_by) ? r.filled_by[0] : r.filled_by
      items.push({
        type: 'substitute_found', id: `filled-${r.id}`, priority: 3,
        request: { requestId: r.id, leagueId: r.league_id, leagueName: league?.name ?? 'League', subName: filledBy?.name ?? null, byOrganizer: r.fulfillment_mode === 'organizer_assigned', date },
      })
    }
  }

  // Matched opportunities — only when opted in (open_to_subbing gates Home surfacing, not /subs).
  if ((profile as any)?.open_to_subbing) {
    const remaining = Math.max(0, MAX_ITEMS - items.length)
    const take = Math.min(MAX_MATCHED, remaining || MAX_MATCHED)
    if (take > 0) {
      const opps = await loadOpenOpportunities(userId, { limit: take })
      for (const o of opps) {
        // Higher rank ⇒ smaller priority number; keep matched below own items.
        items.push({ type: 'matched_sub_opportunity', id: `match-${o.requestId}`, priority: 5 - clamp01(o.rankScore / 200), opportunity: o })
      }
    }
  }

  items.sort((a, b) => a.priority - b.priority)
  return items.slice(0, MAX_ITEMS)
}

function daysFrom(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000)
}
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}
