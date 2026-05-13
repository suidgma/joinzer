'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import LocationCombobox from '@/components/features/events/LocationCombobox'
import TimeSelect from '@/components/features/events/TimeSelect'
import FormSection from '@/components/ui/form-section'
import FormRow from '@/components/ui/form-row'
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
  const [startTime, setStartTime] = useState(tournament.start_time?.slice(0, 5) ?? '08:00')
  const [estimatedEndTime, setEstimatedEndTime] = useState(tournament.estimated_end_time?.slice(0, 5) ?? '17:00')
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

    router.push(`/tournaments/${tournament.id}`)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      <FormSection title="Basics" description="Public-facing tournament details." defaultOpen>
        <FormRow label="Tournament name" htmlFor="name" required>
          <input
            id="name"
            required
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Saturday Beginner Doubles Tournament"
            className="w-full input"
          />
        </FormRow>
        <FormRow label="Description" htmlFor="description">
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Friendly local tournament for beginner and beginner plus players."
            rows={3}
            className="w-full input resize-none"
          />
        </FormRow>
      </FormSection>

      <FormSection title="Schedule" description="Where and when the tournament takes place." defaultOpen>
        <FormRow label="Location" htmlFor="location">
          <LocationCombobox locations={locations} value={locationId} onChange={setLocationId} />
        </FormRow>
        <FormRow label="Date" htmlFor="start-date" required>
          <input
            id="start-date"
            required
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full input"
          />
        </FormRow>
        <FormRow label="Times">
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Start</label>
              <TimeSelect value={startTime} onChange={setStartTime} />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Est. end</label>
              <TimeSelect value={estimatedEndTime} onChange={setEstimatedEndTime} />
            </div>
          </div>
        </FormRow>
      </FormSection>

      <FormSection title="Registration" defaultOpen>
        <FormRow
          label="Entry fee"
          htmlFor="cost"
          helpText="Leave at 0 for a free tournament."
        >
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted text-sm">$</span>
            <input
              id="cost"
              type="number"
              min="0"
              step="5"
              value={costDollars}
              onChange={(e) => setCostDollars(e.target.value)}
              placeholder="0.00"
              className="w-full input pl-7"
            />
          </div>
        </FormRow>
        <FormRow
          label="Registration deadline"
          htmlFor="reg-closes"
          helpText="Closes automatically at end of this date. Leave blank to manage manually."
        >
          <input
            id="reg-closes"
            type="date"
            value={registrationClosesAt}
            onChange={(e) => setRegistrationClosesAt(e.target.value)}
            className="w-full input"
          />
        </FormRow>
        <FormRow label="Registration">
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
        </FormRow>
      </FormSection>

      <FormSection title="Visibility & Publishing" defaultOpen>
        <FormRow label="Status">
          <div className="flex rounded-xl border border-brand-border bg-brand-surface overflow-hidden">
            {([
              { value: 'draft',     label: 'Draft' },
              { value: 'published', label: 'Published' },
              { value: 'cancelled', label: 'Cancelled' },
              { value: 'completed', label: 'Completed' },
            ] as const).map((s) => (
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
        </FormRow>
        <FormRow label="Visibility">
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
        </FormRow>
        {status === 'draft' && (
          <p className="text-xs text-brand-muted px-1 pb-2">
            Draft tournaments are only visible to you. Set to Published to make it public.
          </p>
        )}
        <FormRow
          label="Contact email"
          htmlFor="contact-email"
          helpText="Shown publicly so players can contact the organizer."
        >
          <input
            id="contact-email"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="yourname@email.com"
            className="w-full input"
          />
        </FormRow>
        <FormRow label="Player score entry">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={allowPlayerScores}
              onChange={(e) => setAllowPlayerScores(e.target.checked)}
              className="w-4 h-4 accent-brand"
            />
            <div>
              <p className="text-sm font-medium text-brand-dark">Allow players to submit scores</p>
              <p className="text-xs text-brand-muted">Players can enter scores for their own matches (you still approve them).</p>
            </div>
          </label>
        </FormRow>
      </FormSection>

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
