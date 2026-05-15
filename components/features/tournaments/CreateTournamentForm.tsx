'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import LocationCombobox from '@/components/features/events/LocationCombobox'
import TimeSelect from '@/components/features/events/TimeSelect'
import FormSection from '@/components/ui/form-section'
import FormRow from '@/components/ui/form-row'
import type { LocationOption } from '@/lib/types'

type Props = { locations: LocationOption[] }

// Append Pacific offset to a datetime-local string (YYYY-MM-DDTHH:mm) for DB storage
function ptLocalToIso(local: string): string {
  const month = parseInt(local.slice(5, 7), 10)
  const ptOffset = month >= 4 && month <= 10 ? '-07:00' : '-08:00'
  return `${local}:00${ptOffset}`
}

export default function CreateTournamentForm({ locations }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [locationId, setLocationId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('08:00')
  const [estimatedEndTime, setEstimatedEndTime] = useState('17:00')
  const [status, setStatus] = useState<string>('draft')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [registrationStatus, setRegistrationStatus] = useState<'open' | 'closed'>('open')
  const [registrationClosesAt, setRegistrationClosesAt] = useState('')
  const [deadlineTouched, setDeadlineTouched] = useState(false)
  const [costDollars, setCostDollars] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [allowPlayerScores, setAllowPlayerScores] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

  // Auto-set deadline to 7 days before tournament date at 23:59 PT when startDate changes
  useEffect(() => {
    if (!deadlineTouched && startDate) {
      const d = new Date(startDate + 'T00:00:00')
      d.setDate(d.getDate() - 7)
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      setRegistrationClosesAt(`${yyyy}-${mm}-${dd}T23:59`)
    }
  }, [startDate, deadlineTouched])

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
        start_time: startTime || null,
        estimated_end_time: estimatedEndTime || null,
        organizer_id: user.id,
        status,
        visibility,
        registration_status: registrationStatus,
        registration_closes_at: registrationClosesAt ? ptLocalToIso(registrationClosesAt) : null,
        cost_cents: costDollars ? Math.round(parseFloat(costDollars) * 100) : 0,
        contact_email: contactEmail.trim() || null,
        allow_player_scores: allowPlayerScores,
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
            min={todayStr}
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
          helpText="Closes automatically at this time (Pacific). Leave blank to manage manually."
        >
          <input
            id="reg-closes"
            type="datetime-local"
            value={registrationClosesAt}
            onChange={(e) => { setRegistrationClosesAt(e.target.value); setDeadlineTouched(true) }}
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
        {loading ? 'Creating…' : 'Create Tournament'}
      </button>
    </form>
  )
}
