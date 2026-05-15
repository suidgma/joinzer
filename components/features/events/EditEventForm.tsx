'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import TimeSelect from './TimeSelect'

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
    session_type: string
    price_cents: number | null
    registration_closes_at: string | null
  }
}

// Convert ISO timestamptz to YYYY-MM-DDTHH:mm in PT for datetime-local inputs
function isoToPtLocal(iso: string): string {
  const d = new Date(iso)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = Object.fromEntries(
    formatter.formatToParts(d).map(({ type, value }) => [type, value])
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

// Append Pacific offset to a datetime-local string (YYYY-MM-DDTHH:mm) for DB storage
function ptLocalToIso(local: string): string {
  const month = parseInt(local.slice(5, 7), 10)
  const ptOffset = month >= 4 && month <= 10 ? '-07:00' : '-08:00'
  return `${local}:00${ptOffset}`
}

export default function EditEventForm({ event }: Props) {
  const [title, setTitle] = useState(event.title)
  const [duration, setDuration] = useState(event.duration_minutes)
  const [courtCount, setCourtCount] = useState(event.court_count)
  const [playersPerCourt, setPlayersPerCourt] = useState(event.players_per_court)
  const [notes, setNotes] = useState(event.notes ?? '')
  const [status, setStatus] = useState(event.status)
  const [clinicType, setClinicType] = useState<'none' | 'free' | 'paid'>(
    event.session_type === 'free_clinic' ? 'free' : event.session_type === 'paid_clinic' ? 'paid' : 'none'
  )
  const [priceCents, setPriceCents] = useState<number>(event.price_cents ?? 1000)
  const [registrationClosesAt, setRegistrationClosesAt] = useState(
    event.registration_closes_at ? isoToPtLocal(event.registration_closes_at) : ''
  )
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

    try {
      // Cancellation goes through a server route so joined players get notified
      if (status === 'cancelled' && event.status !== 'cancelled') {
        const res = await fetch(`/api/events/${event.id}/cancel`, { method: 'POST' })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setError(body.error ?? 'Failed to cancel session')
          return
        }
        window.location.href = `/events/${event.id}`
        return
      }

      const startsAt = new Date(`${date}T${time}:00`).toISOString()
      const supabase = createClient()

      const { error: updateErr } = await supabase
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
          session_type: clinicType === 'free' ? 'free_clinic' : clinicType === 'paid' ? 'paid_clinic' : 'game',
          price_cents: clinicType === 'paid' ? priceCents : null,
          registration_closes_at: registrationClosesAt ? ptLocalToIso(registrationClosesAt) : null,
        })
        .eq('id', event.id)

      if (updateErr) {
        setError(updateErr.message)
        return
      }

      window.location.href = `/events/${event.id}`
    } finally {
      setLoading(false)
    }
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
          <TimeSelect value={time} onChange={setTime} required />
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
            {[2, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
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

      <div className="bg-brand-soft border border-brand-border rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-brand-dark">Session type</p>
        <div className="space-y-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={clinicType === 'free'}
              onChange={(e) => setClinicType(e.target.checked ? 'free' : 'none')}
              className="mt-0.5 w-4 h-4 accent-amber-500"
            />
            <div>
              <span className="text-sm font-medium text-brand-dark">Free clinic</span>
              <p className="text-xs text-brand-muted mt-0.5">No charge — shown with a FREE CLINIC badge above regular sessions.</p>
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
              <span className="text-sm font-medium text-brand-dark">Charge a fee per player</span>
              <p className="text-xs text-brand-muted mt-0.5">For clinics, court reservation costs, or any session with a player fee.</p>
            </div>
          </label>
        </div>
        {clinicType === 'paid' && (
          <div className="pl-7 space-y-1">
            <label className="block text-sm font-medium text-brand-dark">Fee per person</label>
            <select
              value={priceCents}
              onChange={(e) => setPriceCents(Number(e.target.value))}
              className="w-40 input"
            >
              {[5,10,15,20,25,30,35,40,45,50,60,70,75,80,90,100].map((d) => (
                <option key={d} value={d * 100}>${d}</option>
              ))}
            </select>
            <p className="text-xs text-brand-muted">You collect payment directly (cash, Venmo, etc.). Joinzer tracks who has paid.</p>
          </div>
        )}
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

      <div>
        <label className="block text-sm font-medium mb-1">
          Registration deadline <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <p className="text-xs text-gray-400 mb-1">Time in Pacific. Leave blank for no automatic cutoff.</p>
        <input
          type="datetime-local"
          value={registrationClosesAt}
          onChange={(e) => setRegistrationClosesAt(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
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
