'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import LocationCombobox from '@/components/features/events/LocationCombobox'
import type { LocationOption } from '@/lib/types'

type Props = { locations: LocationOption[] }

export default function CreateTournamentForm({ locations }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [locationId, setLocationId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [estimatedEndTime, setEstimatedEndTime] = useState('')
  const [status, setStatus] = useState<'draft' | 'published'>('draft')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [registrationStatus, setRegistrationStatus] = useState<'open' | 'closed'>('open')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: tournament, error: insertErr } = await supabase
      .from('tournaments')
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        location_id: locationId || null,
        start_date: startDate,
        start_time: startTime,
        estimated_end_time: estimatedEndTime || null,
        organizer_id: user.id,
        status,
        visibility,
        registration_status: registrationStatus,
      })
      .select('id')
      .single()

    if (insertErr || !tournament) {
      setError(insertErr?.message ?? 'Failed to create tournament')
      setLoading(false)
      return
    }

    router.push(`/tournaments/${tournament.id}`)
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
          placeholder="Saturday Beginner Doubles Tournament"
          className="w-full input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Friendly local tournament for beginner and beginner plus players."
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
          min={todayStr}
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
        {/* Status */}
        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1 uppercase tracking-wide">Status</label>
          <div className="flex rounded-xl border border-brand-border bg-brand-surface overflow-hidden">
            {(['draft', 'published'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`flex-1 py-1.5 text-xs font-semibold transition-colors capitalize ${
                  status === s ? 'bg-brand-dark text-white' : 'text-brand-muted hover:text-brand-dark'
                }`}
              >
                {s === 'draft' ? 'Draft' : 'Published'}
              </button>
            ))}
          </div>
        </div>

        {/* Visibility */}
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

        {/* Registration */}
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

      {status === 'draft' && (
        <p className="text-xs text-brand-muted">
          Draft tournaments are only visible to you. Set to Published to make it public.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
      >
        {loading ? 'Creating…' : 'Create Tournament'}
      </button>
    </form>
  )
}
