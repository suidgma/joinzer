import { describe, it, expect } from 'vitest'
import {
  type WarnableRequest,
  WARNING_WINDOW_HOURS,
  shouldWarn,
  wasWarned,
  warningRecipients,
  warningBody,
} from '../unfilledWarning'

// 3am Pacific on the day of an evening session — the hour the cron actually runs.
const NOW = new Date('2026-08-06T10:00:00.000Z')
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3600_000).toISOString()

function req(over: Partial<WarnableRequest> = {}): WarnableRequest {
  return {
    requestId: 'req-1',
    leagueId: 'league-1',
    leagueName: 'Tuesday Night RR',
    requesterId: 'user-requester',
    organizerId: 'user-organizer',
    sessionDate: '2026-08-06',
    expiresAt: hoursFromNow(15), // 6pm Pacific the same day
    sessionStatus: 'scheduled',
    generated: false,
    notificationGeneration: 0,
    unfilledWarnedGeneration: null,
    ...over,
  }
}

describe('shouldWarn', () => {
  it('warns an unfilled session-scoped request starting later today', () => {
    expect(shouldWarn(req(), NOW)).toBe(true)
  })

  // The case the whole column exists for.
  it('does not warn twice at the same notification generation', () => {
    expect(shouldWarn(req({ notificationGeneration: 0, unfilledWarnedGeneration: 0 }), NOW)).toBe(false)
  })

  it('re-arms after a reopen bumps the generation', () => {
    // Warned at generation 0; the substitute withdrew, which reopened the request at generation 1.
    expect(shouldWarn(req({ notificationGeneration: 1, unfilledWarnedGeneration: 0 }), NOW)).toBe(true)
  })

  // Period-scoped (box/ladder): no clock, so no moment to warn at. Stated as its own test because
  // it is a deliberate product decision, not an accident of a null comparison.
  it('never warns a period-scoped request (expiresAt null)', () => {
    expect(shouldWarn(req({ expiresAt: null, sessionDate: null }), NOW)).toBe(false)
  })

  it('does not warn a session that has already started', () => {
    expect(shouldWarn(req({ expiresAt: hoursFromNow(-1) }), NOW)).toBe(false)
  })

  it('does not warn exactly at the start instant', () => {
    expect(shouldWarn(req({ expiresAt: NOW.toISOString() }), NOW)).toBe(false)
  })

  it('does not warn beyond the window, but does warn at its edge', () => {
    expect(shouldWarn(req({ expiresAt: hoursFromNow(WARNING_WINDOW_HOURS + 1) }), NOW)).toBe(false)
    expect(shouldWarn(req({ expiresAt: hoursFromNow(WARNING_WINDOW_HOURS) }), NOW)).toBe(true)
  })

  it('does not warn once play is generated', () => {
    expect(shouldWarn(req({ generated: true }), NOW)).toBe(false)
  })

  it.each(['completed', 'cancelled'])('does not warn a %s session', (status) => {
    expect(shouldWarn(req({ sessionStatus: status }), NOW)).toBe(false)
  })

  it('ignores an unparseable expires_at rather than throwing', () => {
    expect(shouldWarn(req({ expiresAt: 'not-a-date' }), NOW)).toBe(false)
  })
})

describe('wasWarned — drives whether the post-expiry notice still fires', () => {
  it('is true when the request was warned at its current generation', () => {
    expect(wasWarned({ notificationGeneration: 2, unfilledWarnedGeneration: 2 })).toBe(true)
  })

  // Both of these still get the post-hoc "No substitute was found" notice — that is the point.
  it('is false for a request that was never warned', () => {
    expect(wasWarned({ notificationGeneration: 0, unfilledWarnedGeneration: null })).toBe(false)
  })

  it('is false when a reopen moved the generation past the last warning', () => {
    expect(wasWarned({ notificationGeneration: 1, unfilledWarnedGeneration: 0 })).toBe(false)
  })
})

describe('warningRecipients', () => {
  it('warns the requester and the organizer', () => {
    expect(warningRecipients(req())).toEqual(['user-requester', 'user-organizer'])
  })

  it('does not notify the same person twice when the organizer requested the sub', () => {
    expect(warningRecipients(req({ organizerId: 'user-requester' }))).toEqual(['user-requester'])
  })

  it('still warns the requester when the league has no organizer on record', () => {
    expect(warningRecipients(req({ organizerId: null }))).toEqual(['user-requester'])
  })
})

describe('warningBody', () => {
  it('states the hours remaining', () => {
    expect(warningBody(req({ expiresAt: hoursFromNow(15) }), NOW)).toContain('in about 15 hours')
  })

  it('collapses to "within the hour" when the session is imminent', () => {
    expect(warningBody(req({ expiresAt: hoursFromNow(0.5) }), NOW)).toContain('within the hour')
  })
})
