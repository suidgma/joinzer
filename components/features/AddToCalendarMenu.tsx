'use client'

import { useState, useRef, useEffect } from 'react'
import { Calendar } from 'lucide-react'

type Props = {
  title: string
  startIso: string    // ISO datetime OR YYYY-MM-DD date-only
  endIso?: string     // ISO datetime OR YYYY-MM-DD date-only
  location?: string
  icsUrl: string
}

function toCalDate(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.replace(/-/g, '')
  return new Date(iso).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

function nextDay(dateOnlyIso: string): string {
  const d = new Date(dateOnlyIso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

export default function AddToCalendarMenu({ title, startIso, endIso, location, icsUrl }: Props) {
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
  const start = toCalDate(startIso)
  const end = endIso
    ? toCalDate(endIso)
    : isDateOnly
      ? nextDay(startIso)
      : toCalDate(new Date(new Date(startIso).getTime() + 2 * 3_600_000).toISOString())

  const googleUrl = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${start}/${end}`,
    ...(location ? { location } : {}),
  })

  const yahooUrl = 'https://calendar.yahoo.com/?' + new URLSearchParams({
    v: '60',
    title,
    st: start,
    et: end,
    ...(location ? { in_loc: location } : {}),
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
