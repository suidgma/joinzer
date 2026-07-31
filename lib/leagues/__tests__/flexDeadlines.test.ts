import { describe, it, expect } from 'vitest'
import {
  daysUntilDeadline,
  flexDeadlinePhase,
  recipientsNeedingReminder,
  REMINDER_WINDOW_DAYS,
} from '../flexDeadlines'

describe('daysUntilDeadline', () => {
  it('counts whole days forward and backward', () => {
    expect(daysUntilDeadline('2026-07-31', '2026-07-31')).toBe(0)
    expect(daysUntilDeadline('2026-08-03', '2026-07-31')).toBe(3)
    expect(daysUntilDeadline('2026-07-28', '2026-07-31')).toBe(-3)
  })

  it('counts across a month boundary', () => {
    expect(daysUntilDeadline('2026-08-01', '2026-07-31')).toBe(1)
  })

  it('counts across a DST transition', () => {
    // Both dates are parsed as UTC midnight, so the Pacific DST shift cannot skew the count.
    expect(daysUntilDeadline('2026-11-02', '2026-10-31')).toBe(2)
  })
})

describe('flexDeadlinePhase', () => {
  it('forfeits once the deadline has passed', () => {
    expect(flexDeadlinePhase('2026-07-30', '2026-07-31')).toBe('forfeit')
    expect(flexDeadlinePhase('2026-01-01', '2026-07-31')).toBe('forfeit')
  })

  it('reminds anywhere inside the window, not just on the boundary day', () => {
    // The regression this fixes: the old trigger was `daysUntil === 3`, so days 2, 1 and 0
    // fell through and a single missed run skipped the reminder permanently.
    expect(flexDeadlinePhase('2026-08-03', '2026-07-31')).toBe('remind')
    expect(flexDeadlinePhase('2026-08-02', '2026-07-31')).toBe('remind')
    expect(flexDeadlinePhase('2026-08-01', '2026-07-31')).toBe('remind')
    expect(flexDeadlinePhase('2026-07-31', '2026-07-31')).toBe('remind')
  })

  it('does nothing outside the window', () => {
    expect(flexDeadlinePhase('2026-08-04', '2026-07-31')).toBe('none')
    expect(flexDeadlinePhase('2026-12-31', '2026-07-31')).toBe('none')
  })

  it('treats the window edge as inclusive', () => {
    const endDate = '2026-08-04'
    const dayBeforeWindow = '2026-07-31'
    const firstDayInWindow = '2026-08-01'
    expect(daysUntilDeadline(endDate, firstDayInWindow)).toBe(REMINDER_WINDOW_DAYS)
    expect(flexDeadlinePhase(endDate, dayBeforeWindow)).toBe('none')
    expect(flexDeadlinePhase(endDate, firstDayInWindow)).toBe('remind')
  })
})

describe('recipientsNeedingReminder', () => {
  it('excludes anyone already reminded', () => {
    expect(recipientsNeedingReminder(['a', 'b', 'c'], new Set(['b']))).toEqual(['a', 'c'])
  })

  it('collapses a player appearing in several unplayed fixtures to one reminder', () => {
    expect(recipientsNeedingReminder(['a', 'b', 'a', 'a'], new Set())).toEqual(['a', 'b'])
  })

  it('returns nothing once everyone has been reminded — the catch-up runs are silent', () => {
    expect(recipientsNeedingReminder(['a', 'b'], new Set(['a', 'b']))).toEqual([])
  })

  it('still reminds an entrant who joined after the first wave', () => {
    expect(recipientsNeedingReminder(['a', 'b', 'late'], new Set(['a', 'b']))).toEqual(['late'])
  })

  it('handles an empty entrant list', () => {
    expect(recipientsNeedingReminder([], new Set(['a']))).toEqual([])
  })
})
