// Pacific calendar-day helpers. No imports, so this is directly unit-testable.
//
// Joinzer schedules in Pacific time but stores instants in UTC, and mixing the two is a
// recurring bug shape: building a query window as `${pacificDateStr}T00:00:00.000Z` looks
// right and is wrong by the 7–8h offset, which silently drops evening sessions off one end
// of the day and pulls the previous evening's in at the other.
//
// The safe pattern is over-fetch then filter: bracket the day generously in UTC with
// `pacificDayUtcBounds`, then decide membership exactly with `isPacificDate`.

const PACIFIC = 'America/Los_Angeles'
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

const pacificDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: PACIFIC,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The Pacific calendar date of an instant, as `YYYY-MM-DD`. */
export function pacificDateString(instant: Date | string = new Date()): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant
  return pacificDate.format(date)
}

/** Shift a `YYYY-MM-DD` calendar date by whole days. Calendar arithmetic, not instants. */
export function addCalendarDays(dateStr: string, days: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * UTC instants that strictly contain the given Pacific calendar day, with slack for either
 * standard or daylight offset. Deliberately wider than the real day — it is a prefilter for
 * a query, and `isPacificDate` does the exact membership test.
 */
export function pacificDayUtcBounds(dateStr: string): { start: string; end: string } {
  const midnightUtc = Date.parse(`${dateStr}T00:00:00Z`)
  return {
    start: new Date(midnightUtc - 12 * HOUR_MS).toISOString(),
    end: new Date(midnightUtc + 36 * HOUR_MS).toISOString(),
  }
}

/** Whether an instant falls on the given Pacific calendar day. */
export function isPacificDate(instant: Date | string, dateStr: string): boolean {
  return pacificDateString(instant) === dateStr
}
