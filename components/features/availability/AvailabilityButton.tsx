'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { LocationOption } from '@/lib/types'

const TIME_WINDOWS = [
  { value: 'morning', label: 'Morning', sub: '6am – 12pm' },
  { value: 'afternoon', label: 'Afternoon', sub: '12pm – 5pm' },
  { value: 'evening', label: 'Evening', sub: '5pm – late' },
]

type Props = {
  userId: string
  locations: LocationOption[]
  existing: { date: string; timeWindows: string[] } | null
}

export default function AvailabilityButton({ userId, locations, existing }: Props) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(existing?.date ?? todayStr())
  const [selectedWindows, setSelectedWindows] = useState<string[]>(existing?.timeWindows ?? [])
  const [locationId, setLocationId] = useState('')
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(!!existing && (existing.timeWindows.length > 0))
  const [activeWindows, setActiveWindows] = useState<string[]>(existing?.timeWindows ?? [])

  const todayLocal = todayStr()

  function toggleWindow(value: string) {
    setSelectedWindows((prev) =>
      prev.includes(value) ? prev.filter((w) => w !== value) : [...prev, value]
    )
  }

  async function handleSubmit() {
    if (selectedWindows.length === 0) return
    setLoading(true)
    const supabase = createClient()

    // Delete all existing availability for this user on this date
    await supabase
      .from('player_availability')
      .delete()
      .eq('user_id', userId)
      .eq('date', date)

    // Insert one row per selected window
    const rows = selectedWindows.map((tw) => ({
      user_id: userId,
      date,
      time_window: tw,
      location_id: locationId || null,
    }))

    const { error } = await supabase.from('player_availability').insert(rows)

    if (!error) {
      setActive(true)
      setActiveWindows(selectedWindows)
    }
    setLoading(false)
    setOpen(false)
  }

  async function handleClear() {
    setLoading(true)
    const supabase = createClient()
    await supabase.from('player_availability').delete().eq('user_id', userId)
    setActive(false)
    setActiveWindows([])
    setSelectedWindows([])
    setLoading(false)
    setOpen(false)
  }

  const windowLabel = (() => {
    if (activeWindows.length === 0) return 'Not set'
    if (activeWindows.length === 3) return 'All day'
    if (activeWindows.length === 1) {
      if (activeWindows[0] === 'morning')   return 'Morning'
      if (activeWindows[0] === 'afternoon') return 'Afternoon'
      if (activeWindows[0] === 'evening')   return 'Tonight'
    }
    return activeWindows.map((w) => TIME_WINDOWS.find((t) => t.value === w)?.label).join(' & ')
  })()

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors whitespace-nowrap ${
          active
            ? 'bg-brand-soft border-brand text-brand-dark'
            : 'bg-brand-surface border-brand-border text-brand-muted hover:border-brand-active'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${active ? 'bg-brand-dark' : 'bg-brand-muted'}`} />
        {active ? windowLabel : 'Not set'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm bg-brand-surface rounded-2xl p-5 space-y-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-heading font-bold text-brand-dark">Set availability</h2>
              <button onClick={() => setOpen(false)} className="text-brand-muted text-xl leading-none">&times;</button>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Date</label>
              <input
                type="date"
                value={date}
                min={todayLocal}
                onChange={(e) => setDate(e.target.value)}
                className="w-full input"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Time windows <span className="text-brand-muted font-normal">(select all that apply)</span></label>
              <div className="grid grid-cols-3 gap-2">
                {TIME_WINDOWS.map((tw) => {
                  const selected = selectedWindows.includes(tw.value)
                  return (
                    <button
                      key={tw.value}
                      type="button"
                      onClick={() => toggleWindow(tw.value)}
                      className={`flex flex-col items-center py-2.5 px-1 rounded-xl border text-center transition-colors ${
                        selected
                          ? 'bg-brand border-brand text-brand-dark'
                          : 'bg-brand-soft border-brand-border text-brand-muted'
                      }`}
                    >
                      <span className="text-sm font-medium">{tw.label}</span>
                      <span className="text-xs mt-0.5 opacity-70">{tw.sub}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Preferred location <span className="text-brand-muted font-normal">(optional)</span>
              </label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full input"
              >
                <option value="">Any location</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2 pt-1">
              {active && (
                <button
                  onClick={handleClear}
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-xl border border-brand-border text-sm font-medium text-brand-muted hover:bg-brand-soft transition-colors disabled:opacity-50"
                >
                  Clear
                </button>
              )}
              <button
                onClick={handleSubmit}
                disabled={selectedWindows.length === 0 || loading}
                className="flex-1 py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
              >
                {loading ? 'Saving…' : active ? 'Update' : 'Set available'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
}
