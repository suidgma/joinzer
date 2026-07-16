// Proactive-notification fan-out (service role). Given a newly-opened request, find the bounded top
// pool of OPTED-IN, eligible substitutes to notify — reusing the same hard rules as the browse loader
// and deduping via sub_request_notifications so nobody is spammed. The atomic accept RPC still
// revalidates, so this is a best-effort candidate filter, not an authorization decision.

import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
const pacificDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(iso))

export type SubCandidate = { userId: string; name: string }
export type CandidateResult = { generation: number; candidates: SubCandidate[] }

function genderRequired(reqGender: string | null, format: string | null): string | null {
  if (reqGender && ['male', 'mens', 'men'].includes(reqGender)) return 'male'
  if (reqGender && ['female', 'womens', 'women'].includes(reqGender)) return 'female'
  if (format?.startsWith('mens_')) return 'male'
  if (format?.startsWith('womens_')) return 'female'
  return null
}

// Returns up to `limit` opted-in, eligible, not-yet-notified (for the current notification generation)
// candidates for the request, best first — plus the generation, so markNotified writes the same key.
// `excludeUserId` drops a just-withdrawn substitute from the immediate reopen wave. Ranking here is
// light (prior participant first); the full ranking lives in matching.ts for the requester-facing feed.
export async function loadEligibleCandidatesForRequest(requestId: string, opts: { limit?: number; excludeUserId?: string } = {}): Promise<CandidateResult> {
  const limit = opts.limit ?? 15
  const db = admin()
  const none: CandidateResult = { generation: 0, candidates: [] }

  const { data: req } = await db
    .from('league_sub_requests')
    .select(`id, status, league_id, league_session_id, league_period_id, requesting_player_id, gender_required, expires_at, notification_generation,
      league:leagues!league_id(format, format_kind),
      session:league_sessions!league_session_id(session_date, status),
      period:league_periods!league_period_id(status)`)
    .eq('id', requestId)
    .maybeSingle()
  if (!req) return none
  const r = req as any
  const generation: number = r.notification_generation ?? 0
  if (r.status !== 'open') return none
  if (r.expires_at && new Date(r.expires_at).getTime() <= Date.now()) return none

  const league = Array.isArray(r.league) ? r.league[0] : r.league
  const session = Array.isArray(r.session) ? r.session[0] : r.session
  const period = Array.isArray(r.period) ? r.period[0] : r.period
  const isSession = !!r.league_session_id
  const formatKind = league?.format_kind
  if (isSession ? formatKind !== 'session_rr' : (formatKind !== 'box' && formatKind !== 'ladder')) return none

  // Occasion must not have started / been generated.
  if (isSession) {
    if (['completed', 'cancelled'].includes(session?.status)) return none
    if (await hasRows(db, 'league_rounds', 'session_id', r.league_session_id)) return none
  } else {
    if (period?.status !== 'active') return none
    if (await hasRows(db, 'league_fixtures', 'period_id', r.league_period_id)) return none
  }

  const need = genderRequired(r.gender_required, league?.format ?? null)

  // Opted-in pool (default OFF, so this is small). Gender-filtered, non-stub, not the requester.
  let q = db.from('profiles').select('id, name').eq('open_to_subbing', true).eq('is_stub', false).neq('id', r.requesting_player_id).limit(500)
  if (need) q = q.eq('gender', need)
  const { data: pool } = await q
  let candidateIds = ((pool ?? []) as any[]).map((p) => p.id).filter((id) => id !== opts.excludeUserId)
  const nameById = new Map(((pool ?? []) as any[]).map((p) => [p.id, p.name]))
  if (candidateIds.length === 0) return none

  // Dedupe: drop anyone already notified for THIS request at THIS generation (a reopen bumps the
  // generation, so a fresh wave is allowed without deleting prior delivery history).
  const { data: already } = await db.from('sub_request_notifications').select('user_id').eq('request_id', requestId).eq('generation', generation).in('user_id', candidateIds)
  const notified = new Set((already ?? []).map((a: any) => a.user_id))
  candidateIds = candidateIds.filter((id) => !notified.has(id))
  if (candidateIds.length === 0) return none

  // Exclude anyone already in this occasion.
  const inOccasion = new Set<string>()
  if (isSession) {
    const { data } = await db.from('league_session_players').select('user_id').eq('session_id', r.league_session_id).in('user_id', candidateIds)
    for (const x of (data ?? []) as any[]) inOccasion.add(x.user_id)
  } else {
    const { data } = await db.from('league_attendance').select('user_id').eq('period_id', r.league_period_id).in('user_id', candidateIds)
    for (const x of (data ?? []) as any[]) if (x.user_id) inOccasion.add(x.user_id)
  }
  candidateIds = candidateIds.filter((id) => !inOccasion.has(id))

  // Schedule conflict (RR only, day-granular): committed elsewhere the same Pacific date.
  if (isSession && session?.session_date) {
    const conflicted = new Set<string>()
    const [{ data: sp }, { data: ev }] = await Promise.all([
      db.from('league_session_players').select('user_id, session:league_sessions!session_id(session_date, status)')
        .in('user_id', candidateIds).in('actual_status', ['present', 'coming', 'late']),
      db.from('event_participants').select('user_id, event:events!event_id(starts_at, status)')
        .in('user_id', candidateIds).eq('participant_status', 'joined'),
    ])
    for (const x of (sp ?? []) as any[]) {
      const s = Array.isArray(x.session) ? x.session[0] : x.session
      if (s?.session_date === session.session_date && s?.status !== 'cancelled') conflicted.add(x.user_id)
    }
    for (const x of (ev ?? []) as any[]) {
      const e = Array.isArray(x.event) ? x.event[0] : x.event
      if (e?.starts_at && !['cancelled', 'completed'].includes(e.status) && pacificDate(e.starts_at) === session.session_date) conflicted.add(x.user_id)
    }
    candidateIds = candidateIds.filter((id) => !conflicted.has(id))
  }
  if (candidateIds.length === 0) return none

  // Light ranking: prior participants in this league first (rest keep pool order).
  const { data: regs } = await db.from('league_registrations').select('user_id').eq('league_id', r.league_id).in('user_id', candidateIds)
  const prior = new Set((regs ?? []).map((x: any) => x.user_id))
  candidateIds.sort((a, b) => (prior.has(b) ? 1 : 0) - (prior.has(a) ? 1 : 0))

  return { generation, candidates: candidateIds.slice(0, limit).map((id) => ({ userId: id, name: nameById.get(id) ?? 'A player' })) }
}

async function hasRows(db: ReturnType<typeof admin>, table: string, col: string, val: string): Promise<boolean> {
  const { data } = await db.from(table).select('id').eq(col, val).limit(1)
  return !!(data && data.length > 0)
}

// Record that these users were notified for this request at this generation (dedupe). Best-effort.
export async function markNotified(requestId: string, userIds: string[], generation: number): Promise<void> {
  if (userIds.length === 0) return
  const db = admin()
  await db.from('sub_request_notifications').upsert(
    userIds.map((user_id) => ({ request_id: requestId, user_id, generation })),
    { onConflict: 'request_id,user_id,generation', ignoreDuplicates: true },
  )
}
