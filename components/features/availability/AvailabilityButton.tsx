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
  existing: { id: string; date: string; time_window: string } | null
}

export default function AvailabilityButton({ userId, locations, existing }: Props) {
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(existing?.date ?? todayStr())
  const [timeWindow, setTimeWindow] = useState(existing?.time_window ?? '')
  const [locationId, setLocationId] = useState('')
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(!!existing)
  const [activeId, setActiveId] = useState<string | null>(existing?.id ?? null)

  const todayLocal = todayStr()

  async function handleSubmit() {
    if (!timeWindow) return
    setLoading(true)
    const supabase = createClient()

    // Remove previous if exists
    if (activeId) {
      await supabase.from('player_availability').delete().eq('id', activeId)
    }

    const { data, error } = await supabase
      .from('player_availability')
      .insert({
        user_id: userId,
        date,
        time_window: timeWindow,
        location_id: locationId || null,
      })
      .select('id')
      .single()

    if (!error && data) {
      setActiveId(data.id)
      setActive(true)
    }
    setLoading(false)
    setOpen(false)
  }

  async function handleClear() {
    if (!activeId) return
    setLoading(true)
    const supabase = createClient()
    await supabase.from('player_availability').delete().eq('id', activeId)
    setActive(false)
    setActiveId(null)
    setLoading(false)
    setOpen(false)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full border transition-colors ${
          active
            ? 'bg-brand text-brand-dark border-brand'
            : 'bg-brand-surface text-brand-muted border-brand-border hover:border-brand-active'
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${active ? 'bg-brand-dark' : 'bg-brand-muted'}`} />
        {active ? "I'm available" : 'Set availability'}
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
              <label className="block text-sm font-medium mb-2">Time window</label>
              <div className="grid grid-cols-3 gap-2">
                {TIME_WINDOWS.map((tw) => (
                  <button
                    key={tw.value}
                    type="button"
                    onClick={() => setTimeWindow(tw.value)}
                    className={`flex flex-col items-center py-2.5 px-1 rounded-xl border text-center transition-colors ${
                      timeWindow === tw.value
                        ? 'bg-brand border-brand text-brand-dark'
                        : 'bg-brand-soft border-brand-border text-brand-muted'
                    }`}
                  >
                    <span className="text-sm font-medium">{tw.label}</span>
                    <span className="text-xs mt-0.5 opacity-70">{tw.sub}</span>
                  </button>
                ))}
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
                disabled={!timeWindow || loading}
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
