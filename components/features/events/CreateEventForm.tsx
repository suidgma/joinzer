'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import LocationCombobox from './LocationCombobox'
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const maxPlayers = courtCount * playersPerCourt
  const todayStr = new Date().toISOString().split('T')[0]

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

    // Treat the entered date+time as local (Vegas) time.
    // datetime-local inputs give local browser time — correct for Vegas pilot.
    const startsAt = new Date(`${date}T${time}:00`).toISOString()

    const { data: event, error: eventError } = await supabase
      .from('events')
      .insert({
        title: title.trim(),
        location_id: locationId,
        creator_user_id: user.id,
        captain_user_id: user.id,
        starts_at: startsAt,
        duration_minutes: durationMinutes,
        court_count: courtCount,
        players_per_court: playersPerCourt,
        max_players: maxPlayers,
        notes: notes.trim() || null,
        min_skill_level: minSkill ? parseFloat(minSkill) : null,
        max_skill_level: maxSkill ? parseFloat(maxSkill) : null,
        status: 'open',
      })
      .select('id')
      .single()

    if (eventError || !event) {
      setError(eventError?.message ?? 'Failed to create event')
      setLoading(false)
      return
    }

    // Creator is automatically the first joined participant
    const { error: participantError } = await supabase
      .from('event_participants')
      .insert({
        event_id: event.id,
        user_id: user.id,
        participant_status: 'joined',
      })

    if (participantError) {
      setError(participantError.message)
      setLoading(false)
      return
    }

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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <input
            type="time"
            required
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full input"
          />
        </div>
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
            {[4, 5, 6, 7, 8].map((n) => (
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
        {loading ? 'Creating…' : 'Create session'}
      </button>
    </form>
  )
}
