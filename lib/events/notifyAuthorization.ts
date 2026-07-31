// Authorization for the new-session notification broadcast.
//
// /api/notify-new-session emails every opted-in Joinzer account, from
// `Joinzer <support@joinzer.com>`. It used to check only that *a* user was signed in and
// then take the event details — and the creator id — from the request body, which made any
// signed-in account able to broadcast arbitrary content to the whole user base.
//
// docs/security.md: "Never trust a client-supplied user id, role, or ownership claim;
// re-derive it server-side." The caller id comes from `auth.getUser()`, the event row comes
// from the database, and this function is the comparison between them. It is pure so the
// rejection is locked in by a test rather than by the shape of the route.

// Only the fields the decision actually depends on — a caller passing more is fine.
export type NotifiableEvent = {
  creator_user_id: string
}

// Carries the event back on success so the caller uses the row the decision was made
// about, and so the route needs no non-null assertion to get at it.
export type NotifyAuthorization<TEvent extends NotifiableEvent> =
  | { ok: true; event: TEvent }
  | { ok: false; status: 400 | 403 | 404; error: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The event id is the only thing still read from the request body, so it is checked before
// it reaches a query. Everything the email renders is then looked up from this id.
export function isEventId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function authorizeNewSessionNotification<TEvent extends NotifiableEvent>(
  event: TEvent | null | undefined,
  callerUserId: string | null | undefined
): NotifyAuthorization<TEvent> {
  // An unauthenticated caller never gets here (the route 401s first), but a pure function
  // that fails open on a missing id would be a trap for the next caller.
  if (!callerUserId) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  if (!event) {
    return { ok: false, status: 404, error: 'Session not found' }
  }
  // Creator only, deliberately narrower than the captain-or-creator check the invite and
  // roster routes use. Those act on one session's own participants; this one reaches every
  // opted-in account on the platform, so it gets the least privilege that still serves its
  // only caller — the create-session form, where creator and caller are the same person.
  if (event.creator_user_id !== callerUserId) {
    return { ok: false, status: 403, error: 'Only the session creator can notify players' }
  }
  return { ok: true, event }
}
