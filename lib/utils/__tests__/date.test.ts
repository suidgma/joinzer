import { describe, it, expect } from 'vitest'
import { formatChatTimestamp } from '../date'

// All expectations are Pacific-time, since formatChatTimestamp pins the zone.
const NOW = new Date('2026-07-31T22:42:00Z') // Fri Jul 31 2026, 3:42 PM PDT

describe('formatChatTimestamp', () => {
  it('shows time only for messages sent today', () => {
    expect(formatChatTimestamp('2026-07-31T16:05:00Z', NOW)).toBe('9:05 AM')
  })

  it('shows weekday + time within the last 7 days', () => {
    expect(formatChatTimestamp('2026-07-28T22:42:00Z', NOW)).toBe('Tue 3:42 PM')
  })

  it('shows date + time for older messages', () => {
    expect(formatChatTimestamp('2026-07-01T22:42:00Z', NOW)).toBe('Jul 1, 3:42 PM')
  })

  it('returns an empty string for an unparseable timestamp', () => {
    expect(formatChatTimestamp('not-a-date', NOW)).toBe('')
  })
})
