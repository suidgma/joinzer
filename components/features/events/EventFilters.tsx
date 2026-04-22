'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import type { LocationOption } from '@/lib/types'

const skillOptions = Array.from({ length: 13 }, (_, i) => (2.0 + i * 0.5).toFixed(1))

type Props = {
  locations: LocationOption[]
  view: string
}

export default function EventFilters({ locations, view }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const update = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString())
      if (value) {
        next.set(key, value)
      } else {
        next.delete(key)
      }
      // Changing any filter other than view resets date
      if (key !== 'date' && key !== 'view') next.delete('date')
      router.replace(`${pathname}?${next.toString()}`)
    },
    [params, pathname, router]
  )

  const clear = useCallback(() => {
    router.replace(pathname)
  }, [pathname, router])

  const hasFilters =
    params.has('skill') ||
    params.has('time') ||
    params.has('location')

  return (
    <div className="space-y-2">
      {/* View toggle + clear */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-xl border border-brand-border bg-brand-surface overflow-hidden">
          <button
            onClick={() => update('view', '')}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
              view !== 'calendar'
                ? 'bg-brand-dark text-white'
                : 'text-brand-muted hover:text-brand-dark'
            }`}
          >
            List
          </button>
          <button
            onClick={() => update('view', 'calendar')}
            className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
              view === 'calendar'
                ? 'bg-brand-dark text-white'
                : 'text-brand-muted hover:text-brand-dark'
            }`}
          >
            Calendar
          </button>
        </div>

        {hasFilters && (
          <button
            onClick={clear}
            className="text-xs text-brand-active font-medium hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <select
          value={params.get('skill') ?? ''}
          onChange={(e) => update('skill', e.target.value)}
          className="w-full input-sm"
        >
          <option value="">Any skill</option>
          {skillOptions.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>

        <select
          value={params.get('time') ?? ''}
          onChange={(e) => update('time', e.target.value)}
          className="w-full input-sm"
        >
          <option value="">Any time</option>
          <option value="morning">Morning</option>
          <option value="afternoon">Afternoon (12–5 pm)</option>
          <option value="evening">Evening (5 pm+)</option>
        </select>

        <select
          value={params.get('location') ?? ''}
          onChange={(e) => update('location', e.target.value)}
          className="w-full input-sm"
        >
          <option value="">Any location</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
