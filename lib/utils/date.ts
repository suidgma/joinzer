const VEGAS_TZ = 'America/Los_Angeles'

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

export function formatEventDate(startsAt: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: VEGAS_TZ,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(startsAt))
}
