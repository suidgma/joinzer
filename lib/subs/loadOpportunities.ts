// Server-side substitute-opportunity loaders (service role — league_sub_requests SELECT is scoped to
// own+filled, so the pool is read here, never by the client). Batched queries + the pure matching
// core (matching.ts). Reused by Home (Action Center), /subs, and the notification fan-out.

import { createClient } from '@supabase/supabase-js'
import {
  type MatchedSubOpportunity,
  type OpportunityInput,
  type Viewer,
  evaluateEligibility,
  toOpportunity,
} from '@/lib/subs/matching'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
const pacificToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
const pacificDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(iso))

type Db = ReturnType<typeof admin>

async function loadViewer(db: Db, userId: string): Promise<Viewer | null> {
  const { data } = await db.from('profiles').select('id, gender, is_stub, home_court_id, self_reported_rating').eq('id', userId).maybeSingle()
  if (!data) return null
  const p = data as any
  return { id: p.id, gender: p.gender ?? null, isStub: !!p.is_stub, homeCourtId: p.home_court_id ?? null, rating: p.self_reported_rating != null ? Number(p.self_reported_rating) : null }
}

// The one authoritative matched-opportunity loader. Returns eligible open opportunities, ranked.
export async function loadOpenOpportunities(userId: string, opts: { limit?: number } = {}): Promise<MatchedSubOpportunity[]> {
  const db = admin()
  const viewer = await loadViewer(db, userId)
  if (!viewer || viewer.isStub) return []

  const todayPacific = pacificToday()
  const now = new Date()

  const { data: reqRows } = await db
    .from('league_sub_requests')
    .select(`
      id, league_id, league_session_id, league_period_id, requesting_player_id, format, gender_required, expires_at, created_at,
      league:leagues!league_id(id, name, format, format_kind, skill_min, skill_max, location_id, created_by),
      session:league_sessions!league_session_id(id, session_date, session_time, status, league_id),
      period:league_periods!league_period_id(id, status, league_id)
    `)
    .eq('status', 'open')
    .neq('requesting_player_id', userId)
    .order('created_at', { ascending: false })
    .limit(300)

  const rows = (reqRows ?? []) as any[]
  if (rows.length === 0) return []

  const sessionIds = [...new Set(rows.filter((r) => r.league_session_id).map((r) => r.league_session_id))]
  const periodIds = [...new Set(rows.filter((r) => r.league_period_id).map((r) => r.league_period_id))]
  const locationIds = [...new Set(rows.map((r) => r.league?.location_id).filter(Boolean))]

  const empty = Promise.resolve({ data: [] as any[] })
  const [
    { data: rounds }, { data: fixtures }, { data: myS }, { data: myP },
    { data: commits }, { data: events }, { data: myRegs }, { data: myFilled }, { data: locs },
  ] = await Promise.all([
    sessionIds.length ? db.from('league_rounds').select('session_id').in('session_id', sessionIds) : empty,
    periodIds.length ? db.from('league_fixtures').select('period_id').in('period_id', periodIds) : empty,
    sessionIds.length ? db.from('league_session_players').select('session_id').eq('user_id', userId).in('session_id', sessionIds) : empty,
    periodIds.length ? db.from('league_attendance').select('period_id').eq('user_id', userId).in('period_id', periodIds) : empty,
    db.from('league_session_players').select('actual_status, session:league_sessions!session_id(session_date, status)').eq('user_id', userId).in('actual_status', ['present', 'coming', 'late']),
    db.from('event_participants').select('event:events!event_id(starts_at, status)').eq('user_id', userId).eq('participant_status', 'joined'),
    db.from('league_registrations').select('league_id').eq('user_id', userId).neq('status', 'cancelled'),
    db.from('league_sub_requests').select('league_id').eq('filled_by_user_id', userId).eq('status', 'filled'),
    locationIds.length ? db.from('locations').select('id, name').in('id', locationIds) : empty,
  ])

  const generatedSessions = new Set((rounds ?? []).map((r: any) => r.session_id))
  const generatedPeriods = new Set((fixtures ?? []).map((r: any) => r.period_id))
  const myInSessions = new Set((myS ?? []).map((r: any) => r.session_id))
  const myInPeriods = new Set((myP ?? []).map((r: any) => r.period_id))
  const myLeagues = new Set((myRegs ?? []).map((r: any) => r.league_id))
  const mySubLeagues = new Set((myFilled ?? []).map((r: any) => r.league_id))
  const venueById = new Map((locs ?? []).map((l: any) => [l.id, l.name]))

  // Dates the viewer is already committed to (Pacific), for the RR schedule-conflict.
  const commitDates = new Set<string>()
  for (const c of (commits ?? []) as any[]) {
    const s = Array.isArray(c.session) ? c.session[0] : c.session
    if (s?.session_date && s.status !== 'cancelled') commitDates.add(s.session_date)
  }
  for (const e of (events ?? []) as any[]) {
    const ev = Array.isArray(e.event) ? e.event[0] : e.event
    if (ev?.starts_at && !['cancelled', 'completed'].includes(ev.status)) commitDates.add(pacificDate(ev.starts_at))
  }

  // Organizers the viewer already has a relationship with (registered in one of their leagues).
  let myOrganizers = new Set<string>()
  if (myLeagues.size > 0) {
    const { data: orgLeagues } = await db.from('leagues').select('created_by').in('id', [...myLeagues])
    myOrganizers = new Set((orgLeagues ?? []).map((l: any) => l.created_by).filter(Boolean))
  }

  const out: MatchedSubOpportunity[] = []
  for (const r of rows) {
    const league = r.league
    if (!league) continue
    const isSession = !!r.league_session_id
    const session = Array.isArray(r.session) ? r.session[0] : r.session
    const period = Array.isArray(r.period) ? r.period[0] : r.period
    const scopeType = isSession ? 'session' : 'period'
    const scopeId = isSession ? r.league_session_id : r.league_period_id

    const occasionStarted = isSession
      ? ['completed', 'cancelled'].includes(session?.status)
      : (period?.status !== 'active')

    const input: OpportunityInput = {
      requestId: r.id,
      leagueId: r.league_id,
      leagueName: league.name ?? 'League',
      leagueFormat: league.format ?? null,
      formatKind: league.format_kind,
      organizerId: league.created_by ?? null,
      skillMin: league.skill_min != null ? Number(league.skill_min) : null,
      skillMax: league.skill_max != null ? Number(league.skill_max) : null,
      locationId: league.location_id ?? null,
      venueName: league.location_id ? (venueById.get(league.location_id) ?? null) : null,
      scopeType,
      scopeId,
      requesterId: r.requesting_player_id,
      genderRequired: r.gender_required ?? null,
      date: isSession ? (session?.session_date ?? null) : null,
      startTime: isSession ? (session?.session_time ?? null) : null,
      createdAt: r.created_at,
      expiresAt: r.expires_at ?? null,
      occasionStarted,
      generated: isSession ? generatedSessions.has(scopeId) : generatedPeriods.has(scopeId),
      viewerAlreadyInOccasion: isSession ? myInSessions.has(scopeId) : myInPeriods.has(scopeId),
      viewerScheduleConflict: isSession && !!session?.session_date && commitDates.has(session.session_date),
      viewerPriorParticipant: myLeagues.has(r.league_id),
      viewerPriorSub: mySubLeagues.has(r.league_id),
      viewerSameOrganizer: !!league.created_by && myOrganizers.has(league.created_by) && !myLeagues.has(r.league_id),
    }

    if (!evaluateEligibility(input, viewer, todayPacific, now).eligible) continue
    out.push(toOpportunity(input, viewer, todayPacific))
  }

  out.sort((a, b) => (b.rankScore - a.rankScore) || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
  return typeof opts.limit === 'number' ? out.slice(0, opts.limit) : out
}

// ── Single request, for the shared-link detail page (/subs/[requestId]) ───────
// PII-safe (no requester contact/email). Eligibility for OPEN requests is re-derived via the
// authoritative loader (the shared link is never proof of eligibility). Returns null if not found.
export type SubRequestDetail = {
  requestId: string
  status: 'open' | 'filled' | 'cancelled' | 'expired'
  leagueId: string
  leagueName: string
  leagueFormat: string | null
  scopeType: 'session' | 'period'
  date: string | null
  startTime: string | null
  venueName: string | null
  recommended: string | null
  userRating: number | null
  ratingWarning: string | null
  isRequester: boolean
  eligible: boolean
  canManage: boolean
  subName: string | null
}

export async function loadOpportunityById(userId: string, requestId: string): Promise<SubRequestDetail | null> {
  const db = admin()
  const { data: req } = await db
    .from('league_sub_requests')
    .select(`id, status, league_id, league_session_id, league_period_id, requesting_player_id, skill: format,
      league:leagues!league_id(name, format, skill_min, skill_max, location_id, created_by),
      session:league_sessions!league_session_id(session_date, session_time),
      filled_by:profiles!filled_by_user_id(name)`)
    .eq('id', requestId)
    .maybeSingle()
  if (!req) return null
  const r = req as any
  const league = Array.isArray(r.league) ? r.league[0] : r.league
  const session = Array.isArray(r.session) ? r.session[0] : r.session
  const filledBy = Array.isArray(r.filled_by) ? r.filled_by[0] : r.filled_by
  if (!league) return null

  const skillMin = league.skill_min != null ? Number(league.skill_min) : null
  const skillMax = league.skill_max != null ? Number(league.skill_max) : null
  const [{ data: prof }, { data: loc }] = await Promise.all([
    db.from('profiles').select('self_reported_rating').eq('id', userId).maybeSingle(),
    league.location_id ? db.from('locations').select('name').eq('id', league.location_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const userRating = (prof as any)?.self_reported_rating != null ? Number((prof as any).self_reported_rating) : null
  const recommended = skillMin != null && skillMax != null ? `Recommended rating: ${fmtNum(skillMin)}–${fmtNum(skillMax)}` : null
  const mismatch = userRating != null && skillMin != null && skillMax != null && (userRating < skillMin - 0.5 || userRating > skillMax + 0.5)
  const ratingWarning = mismatch ? `This league is rated ${fmtNum(skillMin!)}–${fmtNum(skillMax!)}; your rating is ${fmtNum(userRating!)}. You can still sub.` : null

  let eligible = false
  if (r.status === 'open') {
    // Own request is excluded from loadOpenOpportunities, so a requester correctly reads eligible=false.
    const opps = await loadOpenOpportunities(userId, { limit: 400 })
    eligible = opps.some((o) => o.requestId === requestId)
  }

  return {
    requestId: r.id, status: r.status, leagueId: r.league_id, leagueName: league.name ?? 'League',
    leagueFormat: league.format ?? null, scopeType: r.league_session_id ? 'session' : 'period',
    date: session?.session_date ?? null, startTime: session?.session_time ?? null,
    venueName: (loc as any)?.name ?? null, recommended, userRating, ratingWarning,
    isRequester: r.requesting_player_id === userId, eligible,
    // Detail-page display gate only (league owner). The organizer-correct ROUTE fully authorizes
    // co-admins + self-run hosts via canOperateSession/authorizeOrganizer — this is not the boundary.
    canManage: league.created_by === userId,
    subName: filledBy?.name ?? null,
  }
}

function fmtNum(n: number): string { return Number.isInteger(n) ? `${n}.0` : `${n}` }

// ── The viewer's own requests (My requests tab + Home own-request items) ──────
export type OwnRequestSummary = {
  id: string
  status: 'open' | 'filled' | 'cancelled' | 'expired'
  fulfillmentMode: string
  leagueId: string
  leagueName: string
  scopeType: 'session' | 'period'
  date: string | null
  sessionNumber: number | null
  subName: string | null
  createdAt: string
}

export async function loadMyRequests(userId: string): Promise<OwnRequestSummary[]> {
  const db = admin()
  const { data } = await db
    .from('league_sub_requests')
    .select(`id, status, fulfillment_mode, created_at, league_id, league_session_id, league_period_id,
      league:leagues!league_id(name), session:league_sessions!league_session_id(session_date, session_number),
      filled_by:profiles!filled_by_user_id(name)`)
    .eq('requesting_player_id', userId)
    .order('created_at', { ascending: false })
    .limit(60)
  return ((data ?? []) as any[]).map((r) => {
    const league = Array.isArray(r.league) ? r.league[0] : r.league
    const session = Array.isArray(r.session) ? r.session[0] : r.session
    const filledBy = Array.isArray(r.filled_by) ? r.filled_by[0] : r.filled_by
    return {
      id: r.id, status: r.status, fulfillmentMode: r.fulfillment_mode, leagueId: r.league_id,
      leagueName: league?.name ?? 'League', scopeType: r.league_session_id ? 'session' : 'period',
      date: session?.session_date ?? null, sessionNumber: session?.session_number ?? null,
      subName: filledBy?.name ?? null, createdAt: r.created_at,
    }
  })
}

// ── The viewer's accepted substitutions (My substitutions tab) ────────────────
export type MySubSummary = {
  id: string
  leagueId: string
  leagueName: string
  scopeType: 'session' | 'period'
  date: string | null
  sessionNumber: number | null
  requesterName: string | null
  fulfillmentMode: string
  filledAt: string | null
}

export async function loadMySubstitutions(userId: string): Promise<MySubSummary[]> {
  const db = admin()
  const { data } = await db
    .from('league_sub_requests')
    .select(`id, fulfillment_mode, filled_at, league_id, league_session_id,
      league:leagues!league_id(name), session:league_sessions!league_session_id(session_date, session_number),
      requester:profiles!requesting_player_id(name)`)
    .eq('filled_by_user_id', userId)
    .eq('status', 'filled')
    .order('filled_at', { ascending: false })
    .limit(60)
  return ((data ?? []) as any[]).map((r) => {
    const league = Array.isArray(r.league) ? r.league[0] : r.league
    const session = Array.isArray(r.session) ? r.session[0] : r.session
    const requester = Array.isArray(r.requester) ? r.requester[0] : r.requester
    return {
      id: r.id, leagueId: r.league_id, leagueName: league?.name ?? 'League',
      scopeType: r.league_session_id ? 'session' : 'period', date: session?.session_date ?? null,
      sessionNumber: session?.session_number ?? null, requesterName: requester?.name ?? null,
      fulfillmentMode: r.fulfillment_mode, filledAt: r.filled_at ?? null,
    }
  })
}
