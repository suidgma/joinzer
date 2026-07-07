const VEGAS_TZ = 'America/Los_Angeles'

// Format a date-only string (YYYY-MM-DD) in Pacific time.
// Uses noon UTC as anchor so the calendar day is unambiguous on any server.
export function formatSessionDate(dateStr: string, opts?: Intl.DateTimeFormatOptions): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  return new Intl.DateTimeFormat('en-US', {
    timeZone: VEGAS_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...opts,
  }).format(d)
}

// Format a full ISO timestamp in Pacific time.
export function formatTimestamp(isoStr: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: VEGAS_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...opts,
  }).format(new Date(isoStr))
}


export function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes / 15) * 15
  const hours = rounded / 60
  const whole = Math.floor(hours)
  const frac = hours - whole

  const fracMap: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' }
  const fracStr = fracMap[frac] ?? ''

  if (whole === 0) return `${fracStr} hr`
  if (frac === 0) return `${whole} hr`
  return `${whole}${fracStr} hr`
}

export function formatEventTime(startsAt: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: VEGAS_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(startsAt))
}

// Format a Postgres `time` value (e.g. "18:00:00") as "6:00 PM"
export function formatTimeValue(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number)
  const date = new Date(2000, 0, 1, h, m)
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date)
}

export function formatEventDate(startsAt: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: VEGAS_TZ,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(startsAt))
}
