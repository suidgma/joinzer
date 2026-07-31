import { describe, it, expect } from 'vitest'
import { authorizeNewSessionNotification, isEventId } from '../notifyAuthorization'

const CREATOR = '11111111-2222-3333-4444-555555555555'
const OTHER_USER = '99999999-8888-7777-6666-555555555555'
const EVENT = { creator_user_id: CREATOR }

describe('authorizeNewSessionNotification', () => {
  it('lets the session creator notify, and hands back the row it decided on', () => {
    // The route renders from `decision.event`, so the authorized row and the rendered row
    // are the same object by construction — there is no second lookup to disagree with it.
    expect(authorizeNewSessionNotification(EVENT, CREATOR)).toEqual({
      ok: true,
      event: EVENT,
    })
  })

  it('rejects a signed-in user who did not create the session', () => {
    // The whole defect: this route emails every opted-in account on the platform, and it
    // used to accept any authenticated caller. A 401 is not authorization.
    expect(authorizeNewSessionNotification(EVENT, OTHER_USER)).toEqual({
      ok: false,
      status: 403,
      error: 'Only the session creator can notify players',
    })
  })

  it('rejects a caller who supplies the creator id but is not that user', () => {
    // The old route read `creatorId` from the request body. Even handed the real creator's
    // id, a different caller must still be refused — the comparison is against the
    // authenticated id, never against anything the client sent.
    const claimedByBody = { creator_user_id: CREATOR }
    expect(authorizeNewSessionNotification(claimedByBody, OTHER_USER).ok).toBe(false)
  })

  it('rejects a missing caller id rather than failing open', () => {
    expect(authorizeNewSessionNotification(EVENT, null)).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })
    expect(authorizeNewSessionNotification(EVENT, undefined).ok).toBe(false)
    expect(authorizeNewSessionNotification(EVENT, '').ok).toBe(false)
  })

  it('404s when the event does not exist, without leaking it as authorized', () => {
    expect(authorizeNewSessionNotification(null, CREATOR)).toEqual({
      ok: false,
      status: 404,
      error: 'Session not found',
    })
    expect(authorizeNewSessionNotification(undefined, CREATOR).ok).toBe(false)
  })

  it('checks the caller before the event, so a missing id is never rescued by a row', () => {
    expect(authorizeNewSessionNotification(null, null)).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })
  })

  it('does not treat a captain-shaped row as creator ownership', () => {
    // Deliberately narrower than the captain-or-creator check used by the per-session
    // invite routes. If that ever changes it should be a decision, not a drift.
    const event = { creator_user_id: CREATOR, captain_user_id: OTHER_USER }
    expect(authorizeNewSessionNotification(event, OTHER_USER).ok).toBe(false)
  })
})

describe('isEventId', () => {
  it('accepts a UUID in either case', () => {
    expect(isEventId(CREATOR)).toBe(true)
    expect(isEventId(CREATOR.toUpperCase())).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['not a uuid', 'not-a-uuid'],
    ['too short', '1111111-2222-3333-4444-555555555555'],
    ['trailing junk', `${CREATOR}x`],
    ['a postgrest filter fragment', `${CREATOR},id.neq.null`],
    ['null', null],
    ['undefined', undefined],
    ['a number', 12345],
    ['an object', { toString: () => CREATOR }],
  ])('rejects %s', (_label, value) => {
    expect(isEventId(value)).toBe(false)
  })
})
