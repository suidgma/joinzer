// Pre-session "still no substitute" warning — the pure selection rules.
//
// Why this exists as its own module: the decision of WHICH requests get warned is the whole feature,
// and it has three edge cases that are invisible in an inline SQL filter (period-scoped requests
// with no clock, a reopen re-arming the warning, and a request created after the day's cron already
// ran). Keeping it pure means those are unit-testable without a database.
//
// The warning is emitted by /api/cron/expire-sub-requests BEFORE its expiry sweep. That cron runs
// 0 11 * * * UTC = 3am PDT / 4am PST — the morning OF that evening's sessions — so a session-scoped
// request warns roughly 15 hours out instead of ~9 hours after the game.

export type WarnableRequest = {
  requestId: string
  leagueId: string
  leagueName: string
  requesterId: string
  organizerId: string | null
  sessionDate: string | null
  // For a session-scoped request this IS the session start (create_player_sub_request derives it as
  // session_date + session_time in Pacific). Period-scoped requests carry null — periods have no
  // clock, so there is no moment to warn at; see shouldWarn.
  expiresAt: string | null
  sessionStatus: string | null
  generated: boolean
  notificationGeneration: number
  unfilledWarnedGeneration: number | null
}

// How far ahead of the session start a request becomes warnable. One day covers the whole gap
// between two runs of a daily cron, so nothing that can be warned is skipped.
export const WARNING_WINDOW_HOURS = 24

// Does this still-open request deserve a "nobody has picked this up yet" warning right now?
export function shouldWarn(r: WarnableRequest, now: Date, windowHours: number = WARNING_WINDOW_HOURS): boolean {
  // Period-scoped (box/ladder): expiresAt is null because a period has no clock. There is no
  // "N hours out" to warn at, so these get no pre-emptive warning at all and keep the post-expiry
  // notice instead. Stated explicitly rather than falling out of a null comparison by accident.
  if (!r.expiresAt) return false

  const startsAt = new Date(r.expiresAt).getTime()
  if (!Number.isFinite(startsAt)) return false

  // Already started (or past). Warning now would be the same post-hoc notice we're replacing.
  if (startsAt <= now.getTime()) return false

  // Too far out to be urgent; it may still get filled, and it will be re-evaluated tomorrow.
  if (startsAt > now.getTime() + windowHours * 3600_000) return false

  // Already warned for this generation. A reopen bumps notificationGeneration, which re-arms the
  // warning automatically — that is the whole reason the key is the generation and not a timestamp.
  if (r.unfilledWarnedGeneration === r.notificationGeneration) return false

  // The occasion is off or already built — nothing actionable remains.
  if (r.generated) return false
  if (r.sessionStatus === 'completed' || r.sessionStatus === 'cancelled') return false

  return true
}

// Was this request warned before it died? Drives whether the post-expiry "No substitute was found"
// notice still fires: exactly one notification per dead request, and the warning is the earlier and
// more useful of the two. Requests that were never warnable — period-scoped, or created after the
// day's run for a session later the same day — fall through here and still get the notice, so
// there is no silent dead end.
export function wasWarned(r: Pick<WarnableRequest, 'notificationGeneration' | 'unfilledWarnedGeneration'>): boolean {
  return r.unfilledWarnedGeneration === r.notificationGeneration
}

// Who hears about it. The requester always; the league organizer too, because at 3am for a 6pm
// session they are the person who can actually assign somebody. Never the same person twice.
export function warningRecipients(r: WarnableRequest): string[] {
  const out = [r.requesterId]
  if (r.organizerId && r.organizerId !== r.requesterId) out.push(r.organizerId)
  return out
}

export function warningBody(r: WarnableRequest, now: Date): string {
  const hours = r.expiresAt ? Math.round((new Date(r.expiresAt).getTime() - now.getTime()) / 3600_000) : null
  const when = hours == null ? 'soon' : hours <= 1 ? 'within the hour' : `in about ${hours} hours`
  return `Nobody has picked up this substitute spot yet and the session starts ${when}.`
}
