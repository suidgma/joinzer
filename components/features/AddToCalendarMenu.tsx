'use client'

import { useState, useRef, useEffect } from 'react'
import { Calendar } from 'lucide-react'

type Props = {
  title: string
  startIso: string    // ISO datetime (UTC/offset), YYYY-MM-DD, or YYYY-MM-DDTHH:MM:SS (local, no Z)
  endIso?: string
  location?: string
  icsUrl: string
  timezone?: string   // e.g. 'America/Los_Angeles' — used when startIso is a local datetime
  /** When true, the menu represents a multi-session series (e.g. a league season) */
  multiSession?: boolean
  /** All session dates (YYYY-MM-DD) for a multi-session series. Used to build a
   *  Google recurrence so every session lands on the calendar in one click. */
  sessionDates?: string[]
}

// Build a Google/iCal RRULE from explicit session dates. Only regular cadences
// (evenly spaced days) can be expressed as a single rule — returns null for
// irregular schedules (e.g. a mid-season gap), where the ICS download is the
// only way to capture every date.
function buildRRule(dates: string[]): string | null {
  const sorted = [...new Set(dates.filter(Boolean))].sort()
  if (sorted.length < 2) return null
  const DAY = 86_400_000
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(Math.round((Date.parse(sorted[i] + 'T00:00:00Z') - Date.parse(sorted[i - 1] + 'T00:00:00Z')) / DAY))
  }
  const uniform = gaps.every(g => g === gaps[0] && g > 0)
  if (!uniform) return null
  const count = sorted.length
  return gaps[0] % 7 === 0
    ? `RRULE:FREQ=WEEKLY;INTERVAL=${gaps[0] / 7};COUNT=${count}`
    : `RRULE:FREQ=DAILY;INTERVAL=${gaps[0]};COUNT=${count}`
}

// Combine a date (YYYY-MM-DD) with the time-of-day carried by a reference ISO
// string, so the recurrence can be anchored to the first session.
function withTimeOf(date: string, refIso: string): string {
  const m = refIso.match(/T(\d{2}:\d{2}(?::\d{2})?)/)
  return m ? `${date}T${m[1]}` : date
}

// Returns calendar date string. Local datetimes (no Z/offset) stay unqualified so
// Google/Yahoo can interpret them in the provided timezone.
function toCalDate(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.replace(/-/g, '')
  // Local datetime (no Z, no +offset) — strip separators but keep no Z
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(iso)) {
    return iso.replace(/[-:]/g, '').padEnd(15, '0').slice(0, 15)
  }
  return new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

function nextDay(dateOnlyIso: string): string {
  const d = new Date(dateOnlyIso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

function addHours(localIso: string, hours: number): string {
  const [datePart, timePart = '00:00:00'] = localIso.split('T')
  const [h, m, s = '00'] = timePart.split(':').map(Number)
  const newH = h + hours
  return `${datePart}T${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function AddToCalendarMenu({ title, startIso, endIso, location, icsUrl, timezone, multiSession, sessionDates }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(startIso)
  const isLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(startIso)

  const start = toCalDate(startIso)
  const end = endIso
    ? toCalDate(endIso)
    : isDateOnly
      ? nextDay(startIso)
      : isLocal
        ? toCalDate(addHours(startIso, 2))
        : toCalDate(new Date(new Date(startIso).getTime() + 2 * 3_600_000).toISOString())

  const googleUrl = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${start}/${end}`,
    ...(location ? { location } : {}),
    ...(timezone ? { ctz: timezone } : {}),
  })

  // Multi-session: try to express the full schedule as a single recurring Google
  // event so every session lands on the calendar in one click. Only works for
  // regular cadences (e.g. weekly) — irregular schedules fall back to the .ics
  // download, the only way to capture every individual date.
  const sortedDates = [...new Set((sessionDates ?? []).filter(Boolean))].sort()
  const rrule = multiSession ? buildRRule(sortedDates) : null
  const recurringGoogleUrl = rrule
    ? (() => {
        const firstIso = withTimeOf(sortedDates[0], startIso)
        const firstStart = toCalDate(firstIso)
        const firstEnd = endIso
          ? toCalDate(withTimeOf(sortedDates[0], endIso))
          : /^\d{4}-\d{2}-\d{2}$/.test(firstIso)
            ? nextDay(sortedDates[0])
            : toCalDate(addHours(firstIso, 2))
        const params = new URLSearchParams({
          action: 'TEMPLATE',
          text: title,
          dates: `${firstStart}/${firstEnd}`,
          ...(location ? { location } : {}),
          ...(timezone ? { ctz: timezone } : {}),
        })
        // Append RRULE raw — Google's `recur` parser expects literal `RRULE:FREQ=...`
        // and silently ignores the recurrence if URLSearchParams percent-encodes
        // the colons/semicolons/equals (%3A/%3B/%3D).
        return `https://calendar.google.com/calendar/render?${params}&recur=${rrule}`
      })()
    : null

  const yahooUrl = 'https://calendar.yahoo.com/?' + new URLSearchParams({
    v: '60',
    title,
    st: start,
    et: end,
    ...(location ? { in_loc: location } : {}),
    ...(timezone ? { tz: timezone } : {}),
  })

  // Multi-session Google option:
  //  - regular cadence  → one-click recurring event covering every session
  //  - irregular schedule → .ics import (only way to capture all dates)
  //  - no session dates  → single event spanning the first/next session
  const googleMulti = recurringGoogleUrl
    ? { label: 'Google Calendar', href: recurringGoogleUrl, external: true }
    : sortedDates.length > 1
      ? { label: 'Google Calendar (.ics import)', href: icsUrl, external: false }
      : { label: 'Google Calendar', href: googleUrl, external: true }

  // Multi-session: Apple and Outlook use the ICS download so all sessions import at once.
  const options = multiSession
    ? [
        googleMulti,
        { label: 'Apple Calendar',  href: icsUrl, external: false },
        { label: 'Outlook / Other', href: icsUrl, external: false },
      ]
    : [
        { label: 'Google Calendar', href: googleUrl, external: true },
        { label: 'Yahoo Calendar',  href: yahooUrl,  external: true },
        { label: 'Apple Calendar',  href: icsUrl,    external: false },
        { label: 'Outlook / Other', href: icsUrl,    external: false },
      ]

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs text-brand-active font-medium underline"
      >
        <Calendar size={12} />
        Add to calendar
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-brand-border rounded-xl shadow-lg py-1 min-w-[170px]">
          {options.map(opt => (
            <a
              key={opt.label}
              href={opt.href}
              target={opt.external ? '_blank' : undefined}
              rel={opt.external ? 'noopener noreferrer' : undefined}
              className="block px-4 py-2 text-sm text-brand-body hover:bg-brand-soft transition-colors whitespace-nowrap"
              onClick={() => setOpen(false)}
            >
              {opt.label}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
