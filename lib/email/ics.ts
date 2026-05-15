export type IcsEvent = {
  uid: string
  title: string
  /** YYYY-MM-DD for all-day, or full ISO string for timed */
  startDate: string
  /** YYYY-MM-DD or ISO. Defaults to day-after for all-day, +2h for timed. */
  endDate?: string
  location?: string
  description?: string
  url?: string
}

function escapeIcs(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function isoToIcsTimestamp(iso: string): string {
  return iso.replace(/[-:]/g, '').split('.')[0] + 'Z'
}

function datePlusOneDay(yyyymmdd: string): string {
  const d = new Date(yyyymmdd + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

function buildVevent(ev: IcsEvent): string {
  const isTimed = ev.startDate.includes('T')

  let dtstart: string
  let dtend: string

  if (isTimed) {
    const start = new Date(ev.startDate)
    dtstart = `DTSTART:${isoToIcsTimestamp(start.toISOString())}`
    if (ev.endDate) {
      dtend = `DTEND:${isoToIcsTimestamp(new Date(ev.endDate).toISOString())}`
    } else {
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
      dtend = `DTEND:${isoToIcsTimestamp(end.toISOString())}`
    }
  } else {
    const ymd = ev.startDate.replace(/-/g, '')
    dtstart = `DTSTART;VALUE=DATE:${ymd}`
    dtend = ev.endDate
      ? `DTEND;VALUE=DATE:${ev.endDate.replace(/-/g, '')}`
      : `DTEND;VALUE=DATE:${datePlusOneDay(ev.startDate)}`
  }

  const lines = [
    'BEGIN:VEVENT',
    `UID:${ev.uid}@joinzer.com`,
    dtstart,
    dtend,
    `SUMMARY:${escapeIcs(ev.title)}`,
    ev.location ? `LOCATION:${escapeIcs(ev.location)}` : null,
    ev.description ? `DESCRIPTION:${escapeIcs(ev.description)}` : null,
    ev.url ? `URL:${ev.url}` : null,
    'END:VEVENT',
  ]

  return lines.filter(Boolean).join('\r\n')
}

export function generateIcs(events: IcsEvent[]): string {
  const vevents = events.map(buildVevent).join('\r\n')
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Joinzer//Joinzer//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    vevents,
    'END:VCALENDAR',
  ].join('\r\n')
}
