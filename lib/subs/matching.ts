// Substitute-opportunity matching — the single authoritative, transparent, testable core reused by
// the Home Action Center, /subs, and proactive-notification fan-out. Pure functions only (no I/O);
// the async loader (loadOpportunities.ts) batches queries and calls these. The atomic accept RPC
// remains the FINAL authority and always revalidates — a matched result is never proof of eligibility.
//
// Three separated concerns (docs/phases/substitutions-implementation-plan.md §6):
//   1. HARD eligibility  → excludes an opportunity outright (mirrors the accept RPC's hard gates)
//   2. SOFT ranking      → orders eligible opportunities (transparent weights, deterministic ties)
//   3. Display warnings   → rating mismatch etc.; NEVER a gate

export type ScopeType = 'session' | 'period'

// The viewer, resolved once.
export type Viewer = {
  id: string
  gender: string | null
  isStub: boolean
  homeCourtId: string | null
  rating: number | null // self_reported_rating (DUPR-style), may be null
}

// A candidate open request + its authoritative, pre-batched context.
export type OpportunityInput = {
  requestId: string
  leagueId: string
  leagueName: string
  leagueFormat: string | null // e.g. 'open_singles', 'mens_doubles'
  formatKind: string // 'session_rr' | 'box' | 'ladder' | (others rejected)
  organizerId: string | null
  skillMin: number | null
  skillMax: number | null
  locationId: string | null
  venueName: string | null
  scopeType: ScopeType
  scopeId: string
  requesterId: string
  genderRequired: string | null // 'male' | 'female' | null
  date: string | null // session_date (YYYY-MM-DD, Pacific), null for periods
  startTime: string | null // session_time HH:MM:SS or null
  createdAt: string
  expiresAt: string | null

  // Pre-batched booleans/sets the loader supplies:
  occasionStarted: boolean // completed/cancelled, or past-dated (RR), or period not active
  generated: boolean // rounds (RR) / fixtures (period) already exist
  viewerAlreadyInOccasion: boolean // viewer has a session-player / attendance row here
  viewerScheduleConflict: boolean // viewer committed elsewhere the same Pacific date (RR only)
  viewerPriorParticipant: boolean // viewer is/was registered in this league
  viewerPriorSub: boolean // viewer previously filled a request in this league
  viewerSameOrganizer: boolean // viewer registered in another league by the same organizer
}

export type EligibilityResult = { eligible: true } | { eligible: false; reason: string }

// Pacific "today" — the caller passes it so this stays pure/deterministic.
export function evaluateEligibility(o: OpportunityInput, v: Viewer, todayPacific: string, now: Date): EligibilityResult {
  if (v.isStub) return { eligible: false, reason: 'accepter_ineligible' }
  if (o.formatKind !== 'session_rr' && o.formatKind !== 'box' && o.formatKind !== 'ladder') {
    return { eligible: false, reason: 'unsupported_format' }
  }
  // scope ↔ format consistency
  if (o.scopeType === 'session' && o.formatKind !== 'session_rr') return { eligible: false, reason: 'scope_mismatch' }
  if (o.scopeType === 'period' && o.formatKind !== 'box' && o.formatKind !== 'ladder') return { eligible: false, reason: 'scope_mismatch' }
  if (o.requesterId === v.id) return { eligible: false, reason: 'own_request' }
  if (o.expiresAt && new Date(o.expiresAt).getTime() <= now.getTime()) return { eligible: false, reason: 'request_expired' }
  if (o.occasionStarted) return { eligible: false, reason: 'occasion_started' }
  if (o.scopeType === 'session' && o.date && o.date < todayPacific) return { eligible: false, reason: 'occasion_started' }
  if (o.generated) return { eligible: false, reason: 'generation_started' }
  if (o.viewerAlreadyInOccasion) return { eligible: false, reason: 'duplicate_participation' }
  if (o.viewerScheduleConflict) return { eligible: false, reason: 'schedule_conflict' }
  const required = normalizeGender(o.genderRequired) ?? genderFromFormat(o.leagueFormat)
  if (required && (v.gender ?? '') !== required) return { eligible: false, reason: 'gender_mismatch' }
  return { eligible: true }
}

function normalizeGender(g: string | null): string | null {
  if (!g) return null
  if (['male', 'mens', 'men'].includes(g)) return 'male'
  if (['female', 'womens', 'women'].includes(g)) return 'female'
  return null
}
function genderFromFormat(format: string | null): string | null {
  if (!format) return null
  if (format.startsWith('mens_')) return 'male'
  if (format.startsWith('womens_')) return 'female'
  return null
}

// ── Ranking ──────────────────────────────────────────────────────────────────
// Transparent additive score. Higher = surface sooner. Signals + weights (documented):
//   urgency (0–100)            — the dominant signal; sooner occasions matter most
//   prior league participant   +30 — you know this league
//   prior sub for this league  +22 — you've covered here before
//   same organizer elsewhere   +12 — familiar organizer
//   rating closeness (0–20)    — closer to the league's recommended band ranks higher
//   home-court match           +15 — same venue
//   recency (0–10)             — newer requests nudged up; also the deterministic-ish nudge
// Ties break on createdAt ascending (older request first) in the loader for full determinism.
export function rankScore(o: OpportunityInput, v: Viewer, todayPacific: string): number {
  let s = 0
  s += urgencyScore(o, todayPacific)
  if (o.viewerPriorParticipant) s += 30
  if (o.viewerPriorSub) s += 22
  if (o.viewerSameOrganizer) s += 12
  s += ratingCloseness(o, v) * 20
  if (v.homeCourtId && o.locationId && v.homeCourtId === o.locationId) s += 15
  s += recencyScore(o.createdAt)
  return Math.round(s * 100) / 100
}

// Urgency 0–100. RR: by days until the session (today = 100, ~12 days out ≈ 0). Periods carry no
// date but are the *active* occasion (imminent) → a high fixed urgency below "today".
export function urgencyScore(o: OpportunityInput, todayPacific: string): number {
  if (o.scopeType === 'period') return 80
  if (!o.date) return 50
  const days = daysBetween(todayPacific, o.date)
  if (days <= 0) return 100
  return Math.max(0, 100 - days * 8)
}

export function urgencyLabel(o: OpportunityInput, todayPacific: string): string {
  if (o.scopeType === 'period') return 'This session'
  if (!o.date) return ''
  const days = daysBetween(todayPacific, o.date)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days <= 6) return `In ${days} days`
  return ''
}

function daysBetween(a: string, b: string): number {
  // Both are YYYY-MM-DD Pacific dates; UTC-midnight diff is exact for date-only math.
  const da = new Date(a + 'T00:00:00Z').getTime()
  const db = new Date(b + 'T00:00:00Z').getTime()
  return Math.round((db - da) / 86400000)
}

// 0 (far / unknown) … 1 (bang on the band). Missing rating or band ⇒ 0 (no boost, no penalty).
export function ratingCloseness(o: OpportunityInput, v: Viewer): number {
  if (v.rating == null || o.skillMin == null || o.skillMax == null) return 0
  const mid = (o.skillMin + o.skillMax) / 2
  const dist = Math.abs(v.rating - mid)
  return Math.max(0, 1 - dist / 2) // within 0 → 1.0, 2.0 rating points away → 0
}

function recencyScore(createdAt: string): number {
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / 3600000
  if (!isFinite(ageHours) || ageHours < 0) return 5
  return Math.max(0, 10 - ageHours / 24)
}

// ── Rating warning (display only; never a gate) ───────────────────────────────
export type RatingWarning = {
  recommended: string | null // "Recommended rating: 3.5–4.0" (or a level label upstream)
  userRating: number | null
  mismatch: boolean
  text: string | null
}

// A "meaningful mismatch" = the viewer's rating is more than half a point outside the league's band.
export function ratingWarning(o: OpportunityInput, v: Viewer): RatingWarning {
  const recommended = o.skillMin != null && o.skillMax != null
    ? `Recommended rating: ${fmt(o.skillMin)}–${fmt(o.skillMax)}`
    : null
  if (v.rating == null || o.skillMin == null || o.skillMax == null) {
    return { recommended, userRating: v.rating, mismatch: false, text: null }
  }
  const mismatch = v.rating < o.skillMin - 0.5 || v.rating > o.skillMax + 0.5
  const text = mismatch
    ? `This league is rated ${fmt(o.skillMin)}–${fmt(o.skillMax)}; your rating is ${fmt(v.rating)}. You can still sub.`
    : null
  return { recommended, userRating: v.rating, mismatch, text }
}

function fmt(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`
}

// The renderable opportunity model returned by the loader.
export type MatchedSubOpportunity = {
  requestId: string
  leagueId: string
  leagueName: string
  leagueFormat: string | null
  scopeType: ScopeType
  scopeId: string
  date: string | null
  startTime: string | null
  venueName: string | null
  genderRequirement: string | null
  recommended: string | null
  userRating: number | null
  ratingWarning: string | null
  urgency: string
  priorLeagueParticipation: boolean
  priorSubHistory: boolean
  createdAt: string
  expiresAt: string | null
  rankScore: number
  detailUrl: string
}

export function toOpportunity(o: OpportunityInput, v: Viewer, todayPacific: string): MatchedSubOpportunity {
  const rw = ratingWarning(o, v)
  return {
    requestId: o.requestId,
    leagueId: o.leagueId,
    leagueName: o.leagueName,
    leagueFormat: o.leagueFormat,
    scopeType: o.scopeType,
    scopeId: o.scopeId,
    date: o.date,
    startTime: o.startTime,
    venueName: o.venueName,
    genderRequirement: normalizeGender(o.genderRequired) ?? genderFromFormat(o.leagueFormat),
    recommended: rw.recommended,
    userRating: rw.userRating,
    ratingWarning: rw.text,
    urgency: urgencyLabel(o, todayPacific),
    priorLeagueParticipation: o.viewerPriorParticipant,
    priorSubHistory: o.viewerPriorSub,
    createdAt: o.createdAt,
    expiresAt: o.expiresAt,
    rankScore: rankScore(o, v, todayPacific),
    detailUrl: `/leagues/${o.leagueId}`,
  }
}
