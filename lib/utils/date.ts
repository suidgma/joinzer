const VEGAS_TZ = 'America/Los_Angeles'

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

export function formatEventDate(startsAt: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: VEGAS_TZ,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(startsAt))
}
