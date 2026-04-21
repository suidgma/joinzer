'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Props = {
  event: {
    id: string
    title: string
    starts_at: string
    duration_minutes: number
    court_count: number
    players_per_court: number
    max_players: number
    notes: string | null
    status: string
  }
}

export default function EditEventForm({ event }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState(event.title)
  const [duration, setDuration] = useState(event.duration_minutes)
  const [courtCount, setCourtCount] = useState(event.court_count)
  const [playersPerCourt, setPlayersPerCourt] = useState(event.players_per_court)
  const [notes, setNotes] = useState(event.notes ?? '')
  const [status, setStatus] = useState(event.status)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Parse starts_at into local date + time strings for the inputs
  const dt = new Date(event.starts_at)
  const pad = (n: number) => String(n).padStart(2, '0')
  const localDate = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
  const localTime = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`

  const [date, setDate] = useState(localDate)
  const [time, setTime] = useState(localTime)

  const maxPlayers = courtCount * playersPerCourt

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const startsAt = new Date(`${date}T${time}:00`).toISOString()
    const supabase = createClient()

    const { error } = await supabase
      .from('events')
      .update({
        title: title.trim(),
        starts_at: startsAt,
        duration_minutes: duration,
        court_count: courtCount,
        players_per_court: playersPerCourt,
        max_players: maxPlayers,
        notes: notes.trim() || null,
        status,
      })
      .eq('id', event.id)

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.push(`/events/${event.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-sm font-medium mb-1">Title <span className="text-red-500">*</span></label>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Date <span className="text-red-500">*</span></label>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Start time <span className="text-red-500">*</span></label>
          <input
            type="time"
            required
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Duration</label>
        <select
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        >
          <option value={60}>1 hour</option>
          <option value={90}>1.5 hours</option>
          <option value={120}>2 hours</option>
          <option value={180}>3 hours</option>
          <option value={240}>4 hours</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Courts</label>
          <select
            value={courtCount}
            onChange={(e) => setCourtCount(Number(e.target.value))}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
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
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          >
            {[4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-sm text-gray-500">
        Capacity: <span className="font-medium text-black">{maxPlayers} players</span>
      </p>

      <div>
        <label className="block text-sm font-medium mb-1">Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        >
          <option value="open">Open</option>
          <option value="full">Full</option>
          <option value="cancelled">Cancelled</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Notes <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black resize-none"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-black text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
      >
        {loading ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  )
}
