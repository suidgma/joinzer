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

export default function AddToCalendarMenu({ title, startIso, endIso, location, icsUrl, timezone }: Props) {
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

  const yahooUrl = 'https://calendar.yahoo.com/?' + new URLSearchParams({
    v: '60',
    title,
    st: start,
    et: end,
    ...(location ? { in_loc: location } : {}),
    ...(timezone ? { tz: timezone } : {}),
  })

  const options = [
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
