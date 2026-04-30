'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import LocationCombobox from './LocationCombobox'
import TimeSelect from './TimeSelect'
import type { LocationOption } from '@/lib/types'

const skillOptions: number[] = Array.from({ length: 13 }, (_, i) => 2.0 + i * 0.5)

export default function CreateEventForm({ locations }: { locations: LocationOption[] }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [locationId, setLocationId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(120)
  const [courtCount, setCourtCount] = useState(1)
  const [playersPerCourt, setPlayersPerCourt] = useState(6)
  const [minSkill, setMinSkill] = useState('')
  const [maxSkill, setMaxSkill] = useState('')
  const [notes, setNotes] = useState('')
  const [clinicType, setClinicType] = useState<'none' | 'free' | 'paid'>('none')
  const [priceCents, setPriceCents] = useState<number>(1000)
  const [repeat, setRepeat] = useState<'none' | 'weekly' | 'biweekly'>('none')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const maxPlayers = courtCount * playersPerCourt
  // Use Vegas local date so evening sessions aren't blocked by UTC rollover
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!locationId) {
      setError('Please select a location')
      return
    }

    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const startsAt = new Date(`${date}T${time}:00`).toISOString()

    // Build list of start times: 1 for no repeat, up to 8 occurrences otherwise
    const intervalDays = repeat === 'weekly' ? 7 : repeat === 'biweekly' ? 14 : 0
    const occurrenceCount = intervalDays > 0 ? 8 : 1
    const recurrenceGroupId = intervalDays > 0 ? crypto.randomUUID() : null

    const startTimes: string[] = Array.from({ length: occurrenceCount }, (_, i) => {
      const d = new Date(startsAt)
      d.setDate(d.getDate() + i * intervalDays)
      return d.toISOString()
    })

    // Insert all occurrences
    const eventRows = startTimes.map((st) => ({
      title: title.trim(),
      location_id: locationId,
      creator_user_id: user.id,
      captain_user_id: user.id,
      starts_at: st,
      duration_minutes: durationMinutes,
      court_count: courtCount,
      players_per_court: playersPerCourt,
      max_players: maxPlayers,
      notes: notes.trim() || null,
      min_skill_level: minSkill ? parseFloat(minSkill) : null,
      max_skill_level: maxSkill ? parseFloat(maxSkill) : null,
      status: 'open',
      session_type: clinicType === 'free' ? 'free_clinic' : clinicType === 'paid' ? 'paid_clinic' : 'game',
      price_cents: clinicType === 'paid' ? priceCents : null,
      recurrence_group_id: recurrenceGroupId,
    }))

    const { data: events, error: eventError } = await supabase
      .from('events')
      .insert(eventRows)
      .select('id')

    if (eventError || !events || events.length === 0) {
      setError(eventError?.message ?? 'Failed to create event')
      setLoading(false)
      return
    }

    // Add creator as joined participant for every occurrence
    const { error: participantError } = await supabase
      .from('event_participants')
      .insert(events.map((ev) => ({
        event_id: ev.id,
        user_id: user.id,
        participant_status: 'joined',
      })))

    if (participantError) {
      setError(participantError.message)
      setLoading(false)
      return
    }

    // Use first event for confirmation email + notifications
    const event = events[0]

    // Notify opted-in users — non-blocking
    fetch('/api/notify-new-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: event.id,
        title: title.trim(),
        locationName: locations.find((l) => l.id === locationId)?.name ?? '',
        startsAt,
        durationMinutes,
        maxPlayers,
        creatorId: user.id,
      }),
    }).catch(() => {})

    // Fire confirmation email — non-blocking, don't fail the flow if it errors
    fetch('/api/send-session-confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: event.id,
        title: title.trim(),
        locationName: locations.find((l) => l.id === locationId)?.name ?? '',
        startsAt,
        durationMinutes,
        maxPlayers,
      }),
    }).catch(() => {})

    router.push(`/events/${event.id}`)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium mb-1">
          Title <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Saturday Morning Open Play"
          className="w-full input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Location <span className="text-red-500">*</span>
        </label>
        <LocationCombobox
          locations={locations}
          value={locationId}
          onChange={setLocationId}
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Date <span className="text-red-500">*</span>
        </label>
        <input
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
          min={todayStr}
          className="w-full input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Start time <span className="text-red-500">*</span>
        </label>
        <TimeSelect value={time} onChange={setTime} required />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Duration</label>
        <select
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(Number(e.target.value))}
          className="w-full input"
        >
          <option value={60}>1 hour</option>
          <option value={90}>1.5 hours</option>
          <option value={120}>2 hours</option>
          <option value={180}>3 hours</option>
          <option value={240}>4 hours</option>
          <option value={300}>5 hours</option>
          <option value={360}>6 hours</option>
          <option value={420}>7 hours</option>
          <option value={480}>8 hours</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Repeat</label>
        <div className="grid grid-cols-3 gap-2">
          {(['none', 'weekly', 'biweekly'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setRepeat(opt)}
              className={`py-2 rounded-xl border text-sm font-medium transition-colors ${
                repeat === opt
                  ? 'bg-brand border-brand text-brand-dark'
                  : 'bg-brand-soft border-brand-border text-brand-muted'
              }`}
            >
              {opt === 'none' ? 'No repeat' : opt === 'weekly' ? 'Weekly' : 'Every 2 weeks'}
            </button>
          ))}
        </div>
        {repeat !== 'none' && (
          <p className="text-xs text-brand-muted mt-1.5">
            Creates 8 sessions — each can be edited or cancelled independently.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Courts</label>
          <select
            value={courtCount}
            onChange={(e) => setCourtCount(Number(e.target.value))}
            className="w-full input"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Players / court</label>
          <select
            value={playersPerCourt}
            onChange={(e) => setPlayersPerCourt(Number(e.target.value))}
            className="w-full input"
          >
            {[2, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-sm text-gray-500">
        Capacity:{' '}
        <span className="font-medium text-brand-dark">{maxPlayers} players</span>
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Min skill</label>
          <select
            value={minSkill}
            onChange={(e) => setMinSkill(e.target.value)}
            className="input"
          >
            <option value="">No minimum</option>
            {skillOptions.map((v) => (
              <option key={v} value={v}>{v.toFixed(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Max skill</label>
          <select
            value={maxSkill}
            onChange={(e) => setMaxSkill(e.target.value)}
            className="input"
          >
            <option value="">& up</option>
            {skillOptions.map((v) => (
              <option key={v} value={v}>{v.toFixed(1)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={clinicType === 'free'}
            onChange={(e) => setClinicType(e.target.checked ? 'free' : 'none')}
            className="mt-0.5 w-4 h-4 accent-amber-500"
          />
          <div>
            <span className="text-sm font-medium text-brand-dark">This is a free clinic</span>
            <p className="text-xs text-brand-muted mt-0.5">Shown above regular sessions with a FREE CLINIC badge.</p>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={clinicType === 'paid'}
            onChange={(e) => setClinicType(e.target.checked ? 'paid' : 'none')}
            className="mt-0.5 w-4 h-4 accent-amber-500"
          />
          <div>
            <span className="text-sm font-medium text-brand-dark">This is a paid clinic</span>
            <p className="text-xs text-brand-muted mt-0.5">Shown above regular sessions with a PAID CLINIC badge.</p>
          </div>
        </label>
        {clinicType === 'paid' && (
          <div className="ml-7">
            <label className="block text-sm font-medium mb-1">Price per person</label>
            <select
              value={priceCents}
              onChange={(e) => setPriceCents(Number(e.target.value))}
              className="w-40 input"
            >
              {[5,10,15,20,25,30,35,40,45,50].map((d) => (
                <option key={d} value={d * 100}>${d}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Notes{' '}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Paddle rotation, balls, reservation details…"
          rows={3}
          className="input resize-none"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-brand text-brand-dark rounded-xl py-2.5 text-sm font-semibold hover:bg-brand-hover active:bg-brand-active disabled:opacity-50 transition-colors"
      >
        {loading ? 'Creating…' : repeat !== 'none' ? 'Create 8 sessions' : 'Create session'}
      </button>
    </form>
  )
}
