// Home "Needs Your Attention" — a server-derived, typed ActionItem[] assembled from authoritative
// existing records (NO action-items table). A discriminated union with room to add more types later
// (unread_announcement, score_confirmation, waitlist_invitation, registration_deadline,
// schedule_change, rating_change) without reworking the shape. docs/phases/substitutions-implementation-plan.md §7.

import { createClient } from '@supabase/supabase-js'
import { loadOpenOpportunities } from '@/lib/subs/loadOpportunities'
import type { MatchedSubOpportunity } from '@/lib/subs/matching'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
type Db = ReturnType<typeof admin>
const pacificToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
const pacificDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(ms))

export type OwnOpenRequestItem = { requestId: string; leagueId: string; leagueName: string; date: string | null; sessionNumber: number | null }
export type SubstituteFoundItem = { requestId: string; leagueId: string; leagueName: string; subName: string | null; byOrganizer: boolean; date: string | null }
export type AttendanceNeededItem = { sessionId: string; leagueId: string; leagueName: string; date: string; sessionNumber: number | null }
export type IncompletePaymentItem = { kind: 'event' | 'tournament_order'; refId: string; title: string; amountCents: number; href: string }
export type ScoreConfirmItem = { leagueId: string; leagueName: string }

export type ActionItem =
  | { type: 'incomplete_payment'; id: string; priority: number; payment: IncompletePaymentItem }
  | { type: 'own_open_sub_request'; id: string; priority: number; request: OwnOpenRequestItem }
  | { type: 'attendance_needed'; id: string; priority: number; attendance: AttendanceNeededItem }
  | { type: 'score_confirmation'; id: string; priority: number; score: ScoreConfirmItem }
  | { type: 'substitute_found'; id: string; priority: number; request: SubstituteFoundItem }
  | { type: 'matched_sub_opportunity'; id: string; priority: number; opportunity: MatchedSubOpportunity }

const MAX_ITEMS = 4
const MAX_MATCHED = 2

// Priority = lower sorts first. Ordering (documented):
//   0    incomplete payment      (money / expiring reservation — most time-sensitive)
//   1    own open sub request    (your unresolved ask; near-start ⇒ smaller number)
//   2    attendance needed       (session today/tomorrow, unconfirmed; today < tomorrow)
//   3    substitute found        (awareness)
//   5    matched sub opportunity (rank folded in as a fractional tiebreak)
export async function getHomeActionItems(userId: string): Promise<ActionItem[]> {
  const db = admin()
  const today = pacificToday()

  const [{ data: profile }, { data: myReqs }, attendance, payments, scoreConfirms] = await Promise.all([
    db.from('profiles').select('open_to_subbing').eq('id', userId).maybeSingle(),
    db.from('league_sub_requests')
      .select(`id, status, fulfillment_mode, filled_at, league_id, league_session_id,
        league:leagues!league_id(name), session:league_sessions!league_session_id(session_date, session_number),
        filled_by:profiles!filled_by_user_id(name)`)
      .eq('requesting_player_id', userId).in('status', ['open', 'filled']).order('created_at', { ascending: false }).limit(20),
    loadAttendanceNeeded(db, userId, today),
    loadIncompletePayments(db, userId),
    loadScoreConfirmations(db, userId),
  ])

  const items: ActionItem[] = []

  // Incomplete payments — top priority.
  for (const p of payments) {
    items.push({ type: 'incomplete_payment', id: `pay-${p.kind}-${p.refId}`, priority: 0, payment: p })
  }

  for (const r of (myReqs ?? []) as any[]) {
    const league = Array.isArray(r.league) ? r.league[0] : r.league
    const session = Array.isArray(r.session) ? r.session[0] : r.session
    const date = session?.session_date ?? null
    if (r.status === 'open') {
      const days = date ? daysFrom(today, date) : 99
      items.push({
        type: 'own_open_sub_request', id: `own-open-${r.id}`, priority: 1 + clamp01(days / 30),
        request: { requestId: r.id, leagueId: r.league_id, leagueName: league?.name ?? 'League', date, sessionNumber: session?.session_number ?? null },
      })
    } else if (r.status === 'filled') {
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

  // Attendance needed — session today/tomorrow the player hasn't responded to (today ranks higher).
  for (const a of attendance) {
    items.push({ type: 'attendance_needed', id: `att-${a.sessionId}`, priority: a.date <= today ? 2 : 2.5, attendance: a })
  }

  // Flex-league score awaiting the player's confirmation (their opponent reported a result).
  for (const s of scoreConfirms) {
    items.push({ type: 'score_confirmation', id: `score-${s.leagueId}`, priority: 2.7, score: s })
  }

  // Matched opportunities — only when opted in (open_to_subbing gates Home surfacing, not /subs).
  if ((profile as any)?.open_to_subbing) {
    const remaining = Math.max(0, MAX_ITEMS - items.length)
    const take = Math.min(MAX_MATCHED, remaining || MAX_MATCHED)
    if (take > 0) {
      const opps = await loadOpenOpportunities(userId, { limit: take })
      for (const o of opps) {
        items.push({ type: 'matched_sub_opportunity', id: `match-${o.requestId}`, priority: 5 - clamp01(o.rankScore / 200), opportunity: o })
      }
    }
  }

  items.sort((a, b) => a.priority - b.priority)
  return items.slice(0, MAX_ITEMS)
}

// Round-robin sessions today/tomorrow the player is registered for but hasn't responded to.
async function loadAttendanceNeeded(db: Db, userId: string, today: string): Promise<AttendanceNeededItem[]> {
  const tomorrow = pacificDay(Date.now() + 86400000)
  const { data: regs } = await db
    .from('league_registrations')
    .select('league_id, league:leagues!league_id(name, format_kind, status)')
    .eq('user_id', userId).eq('status', 'registered')
  const rrLeagues = new Map<string, string>()
  for (const r of (regs ?? []) as any[]) {
    const l = Array.isArray(r.league) ? r.league[0] : r.league
    if (l?.format_kind === 'session_rr' && l?.status === 'active') rrLeagues.set(r.league_id, l.name ?? 'League')
  }
  if (rrLeagues.size === 0) return []

  const { data: sessions } = await db
    .from('league_sessions')
    .select('id, league_id, session_date, session_number')
    .in('league_id', [...rrLeagues.keys()]).eq('status', 'scheduled')
    .gte('session_date', today).lte('session_date', tomorrow)
  const sess = (sessions ?? []) as any[]
  if (sess.length === 0) return []

  const { data: att } = await db
    .from('league_session_attendance')
    .select('league_session_id, attendance_status')
    .eq('user_id', userId).in('league_session_id', sess.map((s) => s.id))
  const statusBySession = new Map((att ?? []).map((a: any) => [a.league_session_id, a.attendance_status]))

  return sess
    .filter((s) => { const st = statusBySession.get(s.id); return !st || st === 'not_responded' })
    .map((s) => ({ sessionId: s.id, leagueId: s.league_id, leagueName: rrLeagues.get(s.league_id) ?? 'League', date: s.session_date, sessionNumber: s.session_number ?? null }))
}

// Reserved-but-unpaid commitments: paid Play events joined-but-unpaid + pending tournament orders.
async function loadIncompletePayments(db: Db, userId: string): Promise<IncompletePaymentItem[]> {
  const out: IncompletePaymentItem[] = []
  const now = Date.now()

  const [{ data: parts }, { data: orders }] = await Promise.all([
    db.from('event_participants')
      .select('event:events!event_id(id, title, starts_at, status, price_cents)')
      .eq('user_id', userId).eq('payment_status', 'unpaid'),
    db.from('tournament_orders')
      .select('id, total_cents, tournament:tournaments!tournament_id(id, name)')
      .eq('user_id', userId).eq('status', 'pending'),
  ])

  for (const p of (parts ?? []) as any[]) {
    const e = Array.isArray(p.event) ? p.event[0] : p.event
    if (e && (e.price_cents ?? 0) > 0 && !['cancelled', 'completed'].includes(e.status) && new Date(e.starts_at).getTime() > now) {
      out.push({ kind: 'event', refId: e.id, title: e.title ?? 'Session', amountCents: e.price_cents, href: `/play/${e.id}` })
    }
  }
  for (const o of (orders ?? []) as any[]) {
    const t = Array.isArray(o.tournament) ? o.tournament[0] : o.tournament
    if (t) out.push({ kind: 'tournament_order', refId: o.id, title: t.name ?? 'Tournament', amountCents: o.total_cents ?? 0, href: `/tournaments/${t.id}` })
  }
  return out
}

// Flex leagues where an opponent reported a match result the player still needs to confirm.
// (Flex is behind a feature flag + rare, so this is naturally empty when unused. One card per league.)
async function loadScoreConfirmations(db: Db, userId: string): Promise<ScoreConfirmItem[]> {
  const { data: regs } = await db
    .from('league_registrations')
    .select('id, league_id, league:leagues!league_id(name, format_kind)')
    .eq('user_id', userId).eq('status', 'registered')
  const flexLeagues = new Map<string, string>()
  const myRegIds = new Set<string>()
  for (const r of (regs ?? []) as any[]) {
    const l = Array.isArray(r.league) ? r.league[0] : r.league
    if (l?.format_kind === 'flex') { flexLeagues.set(r.league_id, l.name ?? 'League'); myRegIds.add(r.id) }
  }
  if (flexLeagues.size === 0) return []

  const { data: fx } = await db
    .from('league_fixtures')
    .select('league_id, team_1_registration_id, team_2_registration_id, reported_by')
    .in('league_id', [...flexLeagues.keys()]).eq('status', 'in_progress')
  const needing = new Set<string>()
  for (const f of (fx ?? []) as any[]) {
    const iAmIn = myRegIds.has(f.team_1_registration_id) || myRegIds.has(f.team_2_registration_id)
    // Opponent reported (someone else) and it's awaiting confirmation → my action.
    if (iAmIn && f.reported_by && f.reported_by !== userId) needing.add(f.league_id)
  }
  return [...needing].map((leagueId) => ({ leagueId, leagueName: flexLeagues.get(leagueId) ?? 'League' }))
}

function daysFrom(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000)
}
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}
