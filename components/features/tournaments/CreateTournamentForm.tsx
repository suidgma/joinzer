'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import LocationCombobox from '@/components/features/events/LocationCombobox'
import LocationAddress from '@/components/features/LocationAddress'
import LocationMapButton from '@/components/features/LocationMapButton'
import NewLocationFields from '@/components/features/NewLocationFields'
import TimeSelect from '@/components/features/events/TimeSelect'
import { createLocation, emptyLocationDraft, type NewLocationDraft } from '@/lib/locations/createLocation'
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
  const [addNewLocation, setAddNewLocation] = useState(false)
  const [newLocation, setNewLocation] = useState<NewLocationDraft>(emptyLocationDraft())
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('08:00')
  const [estimatedEndTime, setEstimatedEndTime] = useState('17:00')
  const [status, setStatus] = useState<string>('draft')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [registrationStatus, setRegistrationStatus] = useState<'open' | 'closed'>('open')
  const [registrationClosesAt, setRegistrationClosesAt] = useState('')
  const [deadlineTouched, setDeadlineTouched] = useState(false)
  const [costDollars, setCostDollars] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [allowPlayerScores, setAllowPlayerScores] = useState(false)
  const [defaultWinBy, setDefaultWinBy] = useState<1 | 2>(1)
  const [defaultGamesTo, setDefaultGamesTo] = useState<number>(11)
  const [defaultBracketType, setDefaultBracketType] = useState<'round_robin' | 'single_elimination' | 'double_elimination' | 'pool_play_playoffs'>('round_robin')
  const [schedulingMethod, setSchedulingMethod] = useState<'timed' | 'rolling'>('timed')
  const [showSeeds, setShowSeeds] = useState(false)
  const [additionalDays, setAdditionalDays] = useState<{ date: string; start_time: string; end_time: string }[]>([])
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
    if (addNewLocation && !newLocation.name.trim()) {
      setError('Enter a name for the new location')
      return
    }
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    // Create the venue on the fly if it was entered manually.
    let locId = locationId
    if (addNewLocation) {
      try {
        const created = await createLocation(newLocation)
        locId = created.id
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save the new location')
        setLoading(false)
        return
      }
    }

    const { data: tournament, error: insertErr } = await supabase
      .from('tournaments')
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        location_id: locId || null,
        start_date: startDate,
        start_time: startTime || null,
        estimated_end_time: estimatedEndTime || null,
        additional_days: additionalDays,
        organizer_id: user.id,
        status,
        visibility,
        registration_status: registrationStatus,
        registration_closes_at: registrationClosesAt ? ptLocalToIso(registrationClosesAt) : null,
        cost_cents: costDollars ? Math.round(parseFloat(costDollars) * 100) : 0,
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim() || null,
        allow_player_scores: allowPlayerScores,
        default_win_by: defaultWinBy,
        default_games_to: defaultGamesTo,
        default_bracket_type: defaultBracketType,
        scheduling_method: schedulingMethod,
        show_seeds: showSeeds,
      })
      .select('id')
      .single()

    if (insertErr || !tournament) {
      setError(insertErr?.message ?? 'Failed to create tournament')
      setLoading(false)
      return
    }

    router.push(`/tournaments/${tournament.id}?created=1`)
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

      <FormSection title="Division Defaults" description="These pre-populate each division you create and can be overridden per division." defaultOpen>
        <FormRow label="Format">
          <div className="flex flex-col gap-2">
            {([
              { value: 'round_robin',        label: 'Round Robin',          desc: 'Every team plays every other team.' },
              { value: 'single_elimination', label: 'Single Elimination',   desc: 'One loss and you\'re out.' },
              { value: 'double_elimination', label: 'Double Elimination',   desc: 'Teams eliminated after two losses.' },
              { value: 'pool_play_playoffs', label: 'Pool Play + Playoffs', desc: 'Groups phase, then bracket playoffs.' },
            ] as const).map(opt => (
              <label key={opt.value} className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${defaultBracketType === opt.value ? 'border-brand bg-brand-soft' : 'border-brand-border bg-white hover:bg-brand-soft/50'}`}>
                <input type="radio" name="default_bracket_type" value={opt.value} checked={defaultBracketType === opt.value} onChange={() => setDefaultBracketType(opt.value)} className="mt-0.5 accent-brand" />
                <div>
                  <p className="text-sm font-semibold text-brand-dark">{opt.label}</p>
                  <p className="text-xs text-brand-muted">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </FormRow>
        <FormRow label="Points to win" width="xs">
          <input
            type="number"
            min="1"
            value={defaultGamesTo}
            onChange={e => setDefaultGamesTo(Number(e.target.value) || 11)}
            onBlur={e => setDefaultGamesTo(Math.max(1, Number(e.target.value) || 11))}
            className="w-full input"
          />
        </FormRow>
        <FormRow label="Win By" width="sm">
          <div className="flex rounded-xl border border-brand-border bg-brand-surface overflow-hidden">
            {([{ value: 1, label: 'Win by 1' }, { value: 2, label: 'Win by 2' }] as const).map(opt => (
              <button key={opt.value} type="button" onClick={() => setDefaultWinBy(opt.value)}
                className={`flex-1 py-2 text-xs font-semibold transition-colors ${defaultWinBy === opt.value ? 'bg-brand text-brand-dark' : 'text-brand-muted hover:bg-brand-soft'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </FormRow>
        <FormRow label="Seed numbers">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={showSeeds} onChange={e => setShowSeeds(e.target.checked)} className="w-4 h-4 accent-brand" />
            <div>
              <p className="text-sm font-medium text-brand-dark">Show seed numbers</p>
              <p className="text-xs text-brand-muted">Display each team&apos;s seed (#1, #2…) on brackets, schedules, and the printed export. Each division can override this.</p>
            </div>
          </label>
        </FormRow>
      </FormSection>

      <FormSection title="Schedule" description="Where and when the tournament takes place." defaultOpen>
        <FormRow label="Scheduling method">
          <div className="flex flex-col gap-2">
            {([
              { value: 'timed',   label: 'Timed Schedule',   desc: 'Every match gets a scheduled start time and court. Best for larger, formal events.' },
              { value: 'rolling', label: 'Rolling Schedule',  desc: 'Matches are numbered and played in order; courts free up and the next match is called. Only the start time is fixed — no clock times.' },
            ] as const).map(opt => (
              <label key={opt.value} className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${schedulingMethod === opt.value ? 'border-brand bg-brand-soft' : 'border-brand-border bg-white hover:bg-brand-soft/50'}`}>
                <input type="radio" name="scheduling_method" value={opt.value} checked={schedulingMethod === opt.value} onChange={() => setSchedulingMethod(opt.value)} className="mt-0.5 accent-brand" />
                <div>
                  <p className="text-sm font-semibold text-brand-dark">{opt.label}</p>
                  <p className="text-xs text-brand-muted">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </FormRow>
        <FormRow label="Location" htmlFor="location">
          {addNewLocation ? (
            <>
              <NewLocationFields draft={newLocation} onChange={setNewLocation} />
              <button type="button" onClick={() => setAddNewLocation(false)} className="mt-1 text-xs text-brand-active hover:underline">
                ← Choose an existing location
              </button>
            </>
          ) : (
            <>
              <LocationCombobox locations={locations} value={locationId} onChange={setLocationId} />
              <LocationAddress location={locations.find((l) => l.id === locationId)} />
              <div className="mt-1 flex items-center gap-3">
                <LocationMapButton locations={locations} value={locationId} onSelect={setLocationId} />
                <button type="button" onClick={() => setAddNewLocation(true)} className="text-xs text-brand-active hover:underline">
                  Can&apos;t find your location? Add a new one
                </button>
              </div>
            </>
          )}
        </FormRow>
        <div className="px-1 pb-1">
          <p className="text-xs font-bold text-brand-dark mb-3">Day 1</p>
        </div>
        <FormRow label="Date" htmlFor="start-date" width="sm" required>
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
        <FormRow label="Times" width="md">
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

        {additionalDays.map((day, i) => (
          <div key={i} className="border-t border-brand-border/50 pt-4 mt-2">
            <div className="flex items-center justify-between px-1 mb-3">
              <p className="text-xs font-bold text-brand-dark">Day {i + 2}</p>
              <button type="button" onClick={() => setAdditionalDays(prev => prev.filter((_, idx) => idx !== i))}
                className="text-xs text-red-500 hover:text-red-700 font-medium">Remove</button>
            </div>
            <FormRow label="Date" width="sm">
              <input type="date" value={day.date} min={todayStr}
                onChange={e => setAdditionalDays(prev => prev.map((d, idx) => idx === i ? { ...d, date: e.target.value } : d))}
                className="w-full input" />
            </FormRow>
            <FormRow label="Times" width="md">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-brand-muted mb-1">Start</label>
                  <TimeSelect value={day.start_time} onChange={v => setAdditionalDays(prev => prev.map((d, idx) => idx === i ? { ...d, start_time: v } : d))} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-brand-muted mb-1">Est. end</label>
                  <TimeSelect value={day.end_time} onChange={v => setAdditionalDays(prev => prev.map((d, idx) => idx === i ? { ...d, end_time: v } : d))} />
                </div>
              </div>
            </FormRow>
          </div>
        ))}

        <div className="px-1 pt-2">
          <button type="button"
            onClick={() => setAdditionalDays(prev => [...prev, { date: '', start_time: '08:00', end_time: '17:00' }])}
            className="text-sm font-semibold text-brand-active hover:underline">
            + Add Day
          </button>
        </div>
      </FormSection>

      <FormSection title="Registration" defaultOpen>
        <FormRow
          label="Entry fee"
          htmlFor="cost"
          width="sm"
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
          width="md"
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
        <FormRow label="Registration" width="sm">
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
        <FormRow label="Status" width="md">
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
        <FormRow label="Visibility" width="sm">
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
          label="Organizer info"
          helpText="Shown publicly so players can contact the organizer."
        >
          <div className="space-y-2">
            <input
              type="text"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Organizer name"
              className="w-full input"
            />
            <input
              id="contact-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="yourname@email.com"
              className="w-full input"
            />
          </div>
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
