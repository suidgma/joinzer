'use client'

import { useState, useMemo } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import type { EventListItem } from '@/lib/types'
import { formatEventTime } from '@/lib/utils/date'

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Convert UTC ISO string to Vegas local date string "YYYY-MM-DD"
function toVegasDateStr(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('en-CA', {
    timeZone: 'America/Los_Angeles',
  })
}

type Props = {
  events: EventListItem[]
  selectedDate: string | null
}

export default function EventCalendar({ events, selectedDate }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const today = new Date()

  const [viewYear, setViewYear] = useState(() => {
    if (selectedDate) return parseInt(selectedDate.slice(0, 4))
    return today.getFullYear()
  })
  const [viewMonth, setViewMonth] = useState(() => {
    if (selectedDate) return parseInt(selectedDate.slice(5, 7)) - 1
    return today.getMonth()
  })

  // Map of "YYYY-MM-DD" → events[]
  const eventsByDate = useMemo(() => {
    const map: Record<string, EventListItem[]> = {}
    for (const ev of events) {
      const d = toVegasDateStr(ev.starts_at)
      if (!map[d]) map[d] = []
      map[d].push(ev)
    }
    return map
  }, [events])

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  function selectDate(dateStr: string) {
    const next = new URLSearchParams(params.toString())
    if (next.get('date') === dateStr) {
      next.delete('date')
    } else {
      next.set('date', dateStr)
    }
    router.replace(`${pathname}?${next.toString()}`)
  }

  // Build calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const todayStr = toVegasDateStr(today.toISOString())

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null)

  const eventsOnSelectedDate = selectedDate ? (eventsByDate[selectedDate] ?? []) : []

  return (
    <div className="space-y-4">
      {/* Month nav */}
      <div className="bg-white border border-brand-border rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border">
          <button
            onClick={prevMonth}
            className="text-brand-muted hover:text-brand-dark p-1 rounded-lg hover:bg-brand-soft transition-colors"
            aria-label="Previous month"
          >
            ‹
          </button>
          <span className="font-heading font-bold text-sm text-brand-dark">
            {MONTH_NAMES[viewMonth]} {viewYear}
          </span>
          <button
            onClick={nextMonth}
            className="text-brand-muted hover:text-brand-dark p-1 rounded-lg hover:bg-brand-soft transition-colors"
            aria-label="Next month"
          >
            ›
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-brand-border">
          {DAY_HEADERS.map((d) => (
            <div key={d} className="text-center text-xs text-brand-muted font-semibold py-2">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {cells.map((day, idx) => {
            if (!day) {
              return <div key={`empty-${idx}`} className="aspect-square" />
            }
            const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const isToday = dateStr === todayStr
            const isSelected = dateStr === selectedDate
            const hasEvents = !!eventsByDate[dateStr]?.length
            const eventCount = eventsByDate[dateStr]?.length ?? 0

            return (
              <button
                key={dateStr}
                onClick={() => selectDate(dateStr)}
                className={`aspect-square flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors rounded-lg m-0.5
                  ${isSelected ? 'bg-brand-dark text-white' : ''}
                  ${isToday && !isSelected ? 'ring-1 ring-brand text-brand-dark' : ''}
                  ${!isSelected && !isToday ? 'text-brand-body hover:bg-brand-soft' : ''}
                `}
              >
                <span>{day}</span>
                {hasEvents && (
                  <span className={`flex gap-0.5 ${isSelected ? 'opacity-80' : ''}`}>
                    {Array.from({ length: Math.min(eventCount, 3) }).map((_, i) => (
                      <span
                        key={i}
                        className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-brand'}`}
                      />
                    ))}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Events for selected date */}
      {selectedDate && (
        <div>
          <p className="text-xs text-brand-muted font-semibold uppercase tracking-wide mb-2">
            {eventsOnSelectedDate.length
              ? `${eventsOnSelectedDate.length} session${eventsOnSelectedDate.length > 1 ? 's' : ''} on ${selectedDate}`
              : `No sessions on ${selectedDate}`}
          </p>
          <div className="space-y-3">
            {eventsOnSelectedDate.map((ev) => {
              const joined = ev.event_participants.filter(p => p.participant_status === 'joined').length
              return (
                <Link key={ev.id} href={`/events/${ev.id}`} className="block">
                  <div className="bg-white border border-brand-border rounded-2xl p-4 hover:border-brand hover:shadow-sm transition-all space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-heading font-semibold text-sm text-brand-dark">{ev.title}</p>
                      <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${ev.status === 'full' ? 'bg-red-100 text-red-700' : 'bg-brand-soft text-brand-active'}`}>
                        {ev.status === 'full' ? 'Full' : 'Open'}
                      </span>
                    </div>
                    <p className="text-xs text-brand-muted">{ev.location?.name ?? 'Location TBD'} · {formatEventTime(ev.starts_at)}</p>
                    <p className="text-xs text-brand-muted">{joined} / {ev.max_players} players</p>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
