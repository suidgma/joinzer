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
  const [registrationClosesAt, setRegistrationClosesAt] = useState(tournament.registration_closes_at ?? '')
  const [costDollars, setCostDollars] = useState(
    tournament.cost_cents ? String((tournament.cost_cents as any) / 100) : ''
  )
  const [contactEmail, setContactEmail] = useState((tournament as any).contact_email ?? '')
  const [allowPlayerScores, setAllowPlayerScores] = useState((tournament as any).allow_player_scores ?? false)
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
        start_time: startTime || null,
        estimated_end_time: estimatedEndTime || null,
        status,
        visibility,
        registration_status: registrationStatus,
        registration_closes_at: registrationClosesAt || null,
        cost_cents: costDollars ? Math.round(parseFloat(costDollars) * 100) : 0,
        contact_email: contactEmail.trim() || null,
        allow_player_scores: allowPlayerScores,
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
        <label className="block text-sm font-medium mb-1">Registration Fee (per player/team)</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted text-sm">$</span>
          <input
            type="number"
            min="0"
            step="5"
            value={costDollars}
            onChange={(e) => setCostDollars(e.target.value)}
            placeholder="0.00"
            className="w-full input pl-7"
          />
        </div>
        <p className="text-xs text-brand-muted mt-1">Leave at 0 for a free tournament</p>
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

      <div>
        <label className="block text-sm font-medium mb-1">Registration Deadline</label>
        <input
          type="date"
          value={registrationClosesAt}
          onChange={(e) => setRegistrationClosesAt(e.target.value)}
          className="w-full input"
        />
        <p className="text-xs text-brand-muted mt-1">Registration closes automatically at end of this date. Leave blank to manage manually.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Start Time</label>
          <input
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

      {/* Status — full width, 4 options need room */}
      <div>
        <label className="block text-sm font-medium mb-1">Status</label>
        <div className="flex rounded-xl border border-brand-border bg-brand-surface overflow-hidden">
          {[
            { value: 'draft',     label: 'Draft' },
            { value: 'published', label: 'Published' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'completed', label: 'Completed' },
          ].map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setStatus(s.value)}
              className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                status === s.value ? 'bg-brand-dark text-white' : 'text-brand-muted hover:text-brand-dark'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Visibility + Registration — 2-column, each only 2 options */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Visibility</label>
          <div className="flex rounded-xl border border-brand-border bg-brand-surface overflow-hidden">
            {(['public', 'private'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVisibility(v)}
                className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                  visibility === v ? 'bg-brand-dark text-white' : 'text-brand-muted hover:text-brand-dark'
                }`}
              >
                {v === 'public' ? 'Public' : 'Private'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Registration</label>
          <div className="flex rounded-xl border border-brand-border bg-brand-surface overflow-hidden">
            {(['open', 'closed'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRegistrationStatus(r)}
                className={`flex-1 py-2 text-xs font-semibold transition-colors ${
                  registrationStatus === r ? 'bg-brand-dark text-white' : 'text-brand-muted hover:text-brand-dark'
                }`}
              >
                {r === 'open' ? 'Open' : 'Closed'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Organizer Contact Email</label>
        <input
          type="email"
          value={contactEmail}
          onChange={e => setContactEmail(e.target.value)}
          placeholder="yourname@email.com"
          className="w-full input"
        />
        <p className="text-xs text-brand-muted mt-1">Shown publicly so players can contact the organizer.</p>
      </div>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={allowPlayerScores}
          onChange={e => setAllowPlayerScores(e.target.checked)}
          className="w-4 h-4 accent-brand"
        />
        <div>
          <p className="text-sm font-medium text-brand-dark">Allow players to submit scores</p>
          <p className="text-xs text-brand-muted">Players can enter scores for their own matches (you still approve them).</p>
        </div>
      </label>

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
