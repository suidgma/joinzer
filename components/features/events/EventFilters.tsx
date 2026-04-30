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
    params.has('location') ||
    params.has('type')

  return (
    <div className="space-y-2.5">
      {/* Row 1: Type tabs (left) + View toggle (right) — one row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-xl border border-brand-border bg-brand-surface overflow-hidden">
          {(['', 'game', 'clinic'] as const).map((t) => {
            const label = t === '' ? 'All' : t === 'game' ? 'Games' : 'Clinics'
            const active = (params.get('type') ?? '') === t
            return (
              <button
                key={t}
                onClick={() => update('type', t)}
                className={`px-4 py-2 text-xs font-semibold transition-colors ${
                  active ? 'bg-brand-dark text-white' : 'text-brand-muted hover:text-brand-dark'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          {hasFilters && (
            <button
              onClick={clear}
              className="text-xs text-brand-active font-medium hover:underline"
            >
              Clear
            </button>
          )}
          <div className="flex rounded-xl border border-brand-border bg-brand-surface overflow-hidden">
            <button
              onClick={() => update('view', '')}
              className={`px-3 py-2 text-xs font-semibold transition-colors ${
                view !== 'calendar' ? 'bg-brand-dark text-white' : 'text-brand-muted hover:text-brand-dark'
              }`}
            >
              List
            </button>
            <button
              onClick={() => update('view', 'calendar')}
              className={`px-3 py-2 text-xs font-semibold transition-colors ${
                view === 'calendar' ? 'bg-brand-dark text-white' : 'text-brand-muted hover:text-brand-dark'
              }`}
            >
              Cal
            </button>
          </div>
        </div>
      </div>

      {/* Row 2: Filters */}
      <div className="flex gap-2">
        <select
          value={params.get('skill') ?? ''}
          onChange={(e) => update('skill', e.target.value)}
          className="flex-1 min-w-0 input-sm"
        >
          <option value="">Any skill</option>
          {skillOptions.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>

        <select
          value={params.get('time') ?? ''}
          onChange={(e) => update('time', e.target.value)}
          className="flex-1 min-w-0 input-sm"
        >
          <option value="">Any time</option>
          <option value="morning">Morning</option>
          <option value="afternoon">Afternoon</option>
          <option value="evening">Evening</option>
        </select>

        <select
          value={params.get('location') ?? ''}
          onChange={(e) => update('location', e.target.value)}
          className="flex-1 min-w-0 input-sm"
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
