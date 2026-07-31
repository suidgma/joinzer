import { describe, it, expect } from 'vitest'
import {
  pacificDateString,
  addCalendarDays,
  pacificDayUtcBounds,
  isPacificDate,
} from '../pacific-day'

describe('pacificDateString', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(pacificDateString('2026-07-31T18:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns the Pacific date, not the UTC date, late in the evening', () => {
    // 2026-08-01T02:00Z is 7pm on July 31 in Pacific daylight time.
    expect(pacificDateString('2026-08-01T02:00:00.000Z')).toBe('2026-07-31')
  })

  it('rolls over at Pacific midnight, not UTC midnight', () => {
    expect(pacificDateString('2026-08-01T06:59:00.000Z')).toBe('2026-07-31')
    expect(pacificDateString('2026-08-01T07:00:00.000Z')).toBe('2026-08-01')
  })

  it('handles standard time (UTC-8) as well as daylight (UTC-7)', () => {
    expect(pacificDateString('2026-01-15T07:59:00.000Z')).toBe('2026-01-14')
    expect(pacificDateString('2026-01-15T08:00:00.000Z')).toBe('2026-01-15')
  })
})

describe('addCalendarDays', () => {
  it('adds and subtracts whole days', () => {
    expect(addCalendarDays('2026-07-31', 1)).toBe('2026-08-01')
    expect(addCalendarDays('2026-08-01', -1)).toBe('2026-07-31')
    expect(addCalendarDays('2026-07-31', 0)).toBe('2026-07-31')
  })

  it('crosses a year boundary', () => {
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('is unaffected by the DST transition', () => {
    // Nov 1 2026 is the Pacific fall-back. A naive +24h on a local Date would land back on
    // the same calendar day.
    expect(addCalendarDays('2026-11-01', 1)).toBe('2026-11-02')
    expect(addCalendarDays('2026-03-07', 1)).toBe('2026-03-08')
  })
})

describe('pacificDayUtcBounds + isPacificDate', () => {
  const day = '2026-08-01'

  it('brackets every instant belonging to the Pacific day', () => {
    const { start, end } = pacificDayUtcBounds(day)
    // Pacific Aug 1 runs 07:00Z Aug 1 → 06:59:59Z Aug 2 under daylight time.
    const firstMoment = '2026-08-01T07:00:00.000Z'
    const lastMoment = '2026-08-02T06:59:59.000Z'

    expect(Date.parse(start)).toBeLessThan(Date.parse(firstMoment))
    expect(Date.parse(end)).toBeGreaterThan(Date.parse(lastMoment))
    expect(isPacificDate(firstMoment, day)).toBe(true)
    expect(isPacificDate(lastMoment, day)).toBe(true)
  })

  it('excludes the evening sessions that the old UTC-boundary window mishandled', () => {
    // These are the two failure modes of `${dateStr}T00:00:00.000Z`..`T23:59:59.999Z`:
    // it pulled in the PREVIOUS evening and dropped the target day's own evening.
    const previousEvening = '2026-08-01T02:00:00.000Z' // 7pm Jul 31 Pacific
    const targetEvening = '2026-08-02T02:00:00.000Z' // 7pm Aug 1 Pacific

    expect(Date.parse(previousEvening)).toBeGreaterThan(Date.parse(`${day}T00:00:00.000Z`))
    expect(isPacificDate(previousEvening, day)).toBe(false)

    expect(Date.parse(targetEvening)).toBeGreaterThan(Date.parse(`${day}T23:59:59.999Z`))
    expect(isPacificDate(targetEvening, day)).toBe(true)
  })

  it('brackets correctly under standard time too', () => {
    const winter = '2026-01-15'
    const { start, end } = pacificDayUtcBounds(winter)
    const firstMoment = '2026-01-15T08:00:00.000Z'
    const lastMoment = '2026-01-16T07:59:59.000Z'

    expect(Date.parse(start)).toBeLessThan(Date.parse(firstMoment))
    expect(Date.parse(end)).toBeGreaterThan(Date.parse(lastMoment))
    expect(isPacificDate(firstMoment, winter)).toBe(true)
    expect(isPacificDate(lastMoment, winter)).toBe(true)
  })

  it('rejects instants on the neighbouring days', () => {
    expect(isPacificDate('2026-08-01T06:00:00.000Z', day)).toBe(false)
    expect(isPacificDate('2026-08-02T08:00:00.000Z', day)).toBe(false)
  })
})
