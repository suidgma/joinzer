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


// Chat bubble timestamp — scales the detail to how old the message is, so today's
// conversation stays uncluttered while older history stays unambiguous.
// today → "3:42 PM", yesterday → "Yesterday, 3:42 PM", older → "Sunday, July 5, 3:42 PM"
// (older messages from a previous year also carry the year).
//
// "Yesterday" is decided on Pacific CALENDAR days, not a 24-hour subtraction — a message
// sent at 11pm is still "Yesterday" when you read it at 1am, and one sent 20 hours ago
// can already be two calendar days back.
export function formatChatTimestamp(isoStr: string, now: Date = new Date()): string {
  const d = new Date(isoStr)
  if (Number.isNaN(d.getTime())) return ''

  // en-CA yields YYYY-MM-DD, which compares as a string.
  const dayKey = (x: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: VEGAS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(x)

  const todayKey = dayKey(now)
  // Step back a calendar day via noon UTC, so a DST shift can't land us on the wrong date.
  const yesterdayKey = dayKey(new Date(new Date(todayKey + 'T12:00:00Z').getTime() - 24 * 60 * 60 * 1000))
  const msgKey = dayKey(d)

  const timePart = new Intl.DateTimeFormat('en-US', {
    timeZone: VEGAS_TZ,
    hour: 'numeric',
    minute: '2-digit',
  }).format(d)

  if (msgKey === todayKey) return timePart
  if (msgKey === yesterdayKey) return `Yesterday, ${timePart}`

  const sameYear = msgKey.slice(0, 4) === todayKey.slice(0, 4)
  const datePart = new Intl.DateTimeFormat('en-US', {
    timeZone: VEGAS_TZ,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d)

  // Joined manually rather than letting Intl combine date + time: its glue string varies
  // by locale data ("July 5 at 3:42 PM" vs "July 5, 3:42 PM"), and we want the comma.
  return `${datePart}, ${timePart}`
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
