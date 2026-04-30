'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import LocationCombobox from '@/components/features/events/LocationCombobox'
import type { LocationOption, TournamentDetail } from '@/lib/types'

type Props = {
  tournament: TournamentDetail
  locations: LocationOption[]
}

export default function EditTournamentForm({ tournament, locations }: Props) {
  const router = useRouter()
  const [name, setName] = useState(tournament.name)
  const [description, setDescription] = useState(tournament.description ?? '')
  const [locationId, setLocationId] = useState(tournament.location_id ?? '')
  const [startDate, setStartDate] = useState(tournament.start_date)
  const [startTime, setStartTime] = useState(tournament.start_time.slice(0, 5))
  const [estimatedEndTime, setEstimatedEndTime] = useState(tournament.estimated_end_time?.slice(0, 5) ?? '')
  const [status, setStatus] = useState(tournament.status)
  const [visibility, setVisibility] = useState(tournament.visibility)
  const [registrationStatus, setRegistrationStatus] = useState(tournament.registration_status)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: updateErr } = await supabase
      .from('tournaments')
      .update({
        name: name.trim(),
        description: description.trim() || null,
        location_id: locationId || null,
        start_date: startDate,
        start_time: startTime,
        estimated_end_time: estimatedEndTime || null,
        status,
        visibility,
        registration_status: registrationStatus,
      })
      .eq('id', tournament.id)

    if (updateErr) {
      setError(updateErr.message)
      setLoading(false)
      return
    }

    window.location.href = `/tournaments/${tournament.id}`
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      <div>
        <label className="block text-sm font-medium mb-1">
          Tournament Name <span className="text-red-500">*</span>
        </label>
        <input
          required
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full input resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Location</label>
        <LocationCombobox locations={locations} value={locationId} onChange={setLocationId} />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Date <span className="text-red-500">*</span>
        </label>
        <input
          required
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-full input"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">
            Start Time <span className="text-red-500">*</span>
          </label>
          <input
            required
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full input"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Est. End Time</label>
          <input
            type="time"
            value={estimatedEndTime}
            onChange={(e) => setEstimatedEndTime(e.target.value)}
            className="w-full input"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1 uppercase tracking-wide">Status</label>
          <div className="flex rounded-xl border border-brand-border bg-brand-surface overflow-hidden">
            {['draft', 'published', 'cancelled', 'completed'].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`flex-1 py-1.5 text-[10px] font-semibold transition-colors capitalize ${
                  status === s ? 'bg-brand-dark text-white' : 'text-brand-muted hover:text-brand-dark'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1 uppercase tracking-wide">Visibility</label>
          <div className="flex rounded-xl border border-brand-border bg-brand-surface overflow-hidden">
            {(['public', 'private'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVisibility(v)}
                className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${
                  visibility === v ? 'bg-brand-dark text-white' : 'text-brand-muted hover:text-brand-dark'
                }`}
              >
                {v === 'public' ? 'Public' : 'Private'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1 uppercase tracking-wide">Registration</label>
          <div className="flex rounded-xl border border-brand-border bg-brand-surface overflow-hidden">
            {(['open', 'closed'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRegistrationStatus(r)}
                className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${
                  registrationStatus === r ? 'bg-brand-dark text-white' : 'text-brand-muted hover:text-brand-dark'
                }`}
              >
                {r === 'open' ? 'Open' : 'Closed'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
      >
        {loading ? 'Saving…' : 'Save Changes'}
      </button>
    </form>
  )
}
