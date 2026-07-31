import { describe, it, expect } from 'vitest'
import { formatChatTimestamp } from '../date'

// All expectations are Pacific-time, since formatChatTimestamp pins the zone.
const NOW = new Date('2026-07-31T22:42:00Z') // Fri Jul 31 2026, 3:42 PM PDT

describe('formatChatTimestamp', () => {
  it('shows time only for messages sent today', () => {
    expect(formatChatTimestamp('2026-07-31T16:05:00Z', NOW)).toBe('9:05 AM')
  })

  it('labels yesterday by name', () => {
    expect(formatChatTimestamp('2026-07-30T21:00:00Z', NOW)).toBe('Yesterday, 2:00 PM')
  })

  it('shows weekday, date and time for older messages', () => {
    expect(formatChatTimestamp('2026-07-05T21:00:00Z', NOW)).toBe('Sunday, July 5, 2:00 PM')
  })

  it('adds the year when the message is from a previous year', () => {
    expect(formatChatTimestamp('2025-12-05T22:00:00Z', NOW)).toBe('Friday, December 5, 2025, 2:00 PM')
  })

  // Calendar-day boundaries, not 24-hour arithmetic.
  it('treats late-night yesterday as Yesterday when read after midnight', () => {
    const justAfterMidnight = new Date('2026-08-01T07:10:00Z') // 12:10 AM PDT, Aug 1
    // 11:50 PM PDT on Jul 31 — only 20 minutes earlier, but a different calendar day.
    expect(formatChatTimestamp('2026-08-01T06:50:00Z', justAfterMidnight)).toBe('Yesterday, 11:50 PM')
  })

  it('does not call something Yesterday just because it is under 24 hours old', () => {
    const earlyMorning = new Date('2026-07-31T08:00:00Z') // 1:00 AM PDT, Jul 31
    // 23 hours earlier is 2:00 AM PDT on Jul 30 — two calendar days back is wrong, one is right.
    expect(formatChatTimestamp('2026-07-30T09:00:00Z', earlyMorning)).toBe('Yesterday, 2:00 AM')
  })

  it('returns an empty string for an unparseable timestamp', () => {
    expect(formatChatTimestamp('not-a-date', NOW)).toBe('')
  })
})
