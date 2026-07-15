'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PriceTiersEditor from '@/components/features/PriceTiersEditor'
import { normalizeTiers, type PriceTier } from '@/lib/payments/priceTiers'
import PrizesEditor from '@/components/features/PrizesEditor'
import { normalizePrizes, type Prize } from '@/lib/prizes'
import LocationCombobox from './LocationCombobox'
import LocationAddress from '@/components/features/LocationAddress'
import LocationMapButton from '@/components/features/LocationMapButton'
import NewLocationFields from '@/components/features/NewLocationFields'
import TimeSelect from './TimeSelect'
import type { LocationOption } from '@/lib/types'
import { createLocation, emptyLocationDraft, type NewLocationDraft } from '@/lib/locations/createLocation'
import type { EventDefaults } from '@/app/(app)/play/create/page'
import { prepareEventWrite } from '@/lib/taxonomy/write-helpers'

const skillOptions: number[] = Array.from({ length: 13 }, (_, i) => 2.0 + i * 0.5)

function computeEndTime(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(':').map(Number)
  const totalMins = h * 60 + m + durationMinutes
  const endH = Math.floor(totalMins / 60) % 24
  const endM = totalMins % 60
  const period = endH >= 12 ? 'PM' : 'AM'
  const h12 = endH % 12 || 12
  return `${h12}:${String(endM).padStart(2, '0')} ${period}`
}

// Append Pacific offset to a datetime-local string (YYYY-MM-DDTHH:mm) for DB storage
function ptLocalToIso(local: string): string {
  const month = parseInt(local.slice(5, 7), 10)
  const ptOffset = month >= 4 && month <= 10 ? '-07:00' : '-08:00'
  return `${local}:00${ptOffset}`
}

export default function CreateEventForm({ locations, defaults }: { locations: LocationOption[]; defaults?: EventDefaults }) {
  const router = useRouter()
  const [title, setTitle] = useState(defaults?.title ?? '')
  const [locationId, setLocationId] = useState(defaults?.locationId ?? '')
  const [addNewLocation, setAddNewLocation] = useState(false)
  const [newLocation, setNewLocation] = useState<NewLocationDraft>(emptyLocationDraft())
  const [date, setDate] = useState('')
  const [time, setTime] = useState(defaults?.time ?? '08:00')
  const [durationMinutes, setDurationMinutes] = useState(defaults?.durationMinutes ?? 120)
  const [courtCount, setCourtCount] = useState(defaults?.courtCount ?? 1)
  const [playersPerCourt, setPlayersPerCourt] = useState(defaults?.playersPerCourt ?? 6)
  const [minSkill, setMinSkill] = useState(defaults?.minSkill ?? '')
  const [maxSkill, setMaxSkill] = useState(defaults?.maxSkill ?? '')
  const [notes, setNotes] = useState(defaults?.notes ?? '')
  const [clinicType, setClinicType] = useState<'none' | 'free' | 'paid'>(
    defaults?.sessionType === 'free_clinic' ? 'free' : defaults?.sessionType === 'paid_clinic' ? 'paid' : 'none'
  )
  const [priceCents, setPriceCents] = useState<number>(defaults?.priceCents ?? 1000)
  const [noRefundDate, setNoRefundDate] = useState('')
  const [refundPolicy, setRefundPolicy] = useState('')
  const [prizes, setPrizes] = useState<Prize[]>([])
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([])
  const [repeat, setRepeat] = useState<'none' | 'weekly' | 'biweekly'>('none')
  const [registrationClosesAt, setRegistrationClosesAt] = useState('')
  const [deadlineTouched, setDeadlineTouched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const maxPlayers = courtCount * playersPerCourt
  // Use Vegas local date so evening sessions aren't blocked by UTC rollover
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())

  // Auto-set deadline to 7 days before event date at 23:59 PT when date changes
  useEffect(() => {
    if (!deadlineTouched && date) {
      const d = new Date(date + 'T00:00:00')
      d.setDate(d.getDate() - 7)
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      setRegistrationClosesAt(`${yyyy}-${mm}-${dd}T23:59`)
    }
  }, [date, deadlineTouched])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (addNewLocation ? !newLocation.name.trim() : !locationId) {
      setError(addNewLocation ? 'Enter a name for the new location' : 'Please select a location')
      return
    }

    setLoading(true)
    setError(null)

    try {

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    // Resolve the venue — create it on the fly if the organizer entered it manually.
    let locId = locationId
    let locName = locations.find((l) => l.id === locationId)?.name ?? ''
    if (addNewLocation) {
      const created = await createLocation(newLocation)
      locId = created.id
      locName = created.name
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

    const deadlineIso = registrationClosesAt ? ptLocalToIso(registrationClosesAt) : null

    // Insert all occurrences
    const eventRows = startTimes.map((st) => ({
      title: title.trim(),
      location_id: locId,
      creator_user_id: user.id,
      captain_user_id: user.id,
      starts_at: st,
      duration_minutes: durationMinutes,
      court_count: courtCount,
      players_per_court: playersPerCourt,
      max_players: maxPlayers,
      notes: notes.trim() || null,
      ...prepareEventWrite({
        min_skill_level: minSkill ? parseFloat(minSkill) : null,
        max_skill_level: maxSkill ? parseFloat(maxSkill) : null,
      }),
      status: 'open',
      session_type: clinicType === 'free' ? 'free_clinic' : clinicType === 'paid' ? 'paid_clinic' : 'game',
      price_cents: clinicType === 'paid' ? priceCents : null,
      recurrence_group_id: recurrenceGroupId,
      registration_closes_at: deadlineIso,
      no_refund_date: noRefundDate || null,
      refund_policy: refundPolicy.trim() || null,
      prizes: prizes.length ? prizes : null,
      price_tiers: priceTiers.filter((t) => t.until).length ? priceTiers.filter((t) => t.until) : null,
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
        locationName: locName,
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
        locationName: locName,
        startsAt,
        durationMinutes,
        maxPlayers,
      }),
    }).catch(() => {})

    router.push(`/play/${event.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
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
        {addNewLocation ? (
          <>
            <NewLocationFields draft={newLocation} onChange={setNewLocation} />
            <button
              type="button"
              onClick={() => setAddNewLocation(false)}
              className="mt-1 text-xs text-brand-active hover:underline"
            >
              ← Choose an existing location
            </button>
          </>
        ) : (
          <>
            <LocationCombobox
              locations={locations}
              value={locationId}
              onChange={setLocationId}
            />
            <LocationAddress location={locations.find((l) => l.id === locationId)} />
            <div className="mt-1 flex items-center gap-3">
              <LocationMapButton locations={locations} value={locationId} onSelect={setLocationId} />
              <button
                type="button"
                onClick={() => setAddNewLocation(true)}
                className="text-xs text-brand-active hover:underline"
              >
                Can&apos;t find your location? Add a new one
              </button>
            </div>
          </>
        )}
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
          className="w-full sm:max-w-[14rem] input"
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
          className="w-full sm:max-w-[12rem] input"
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
        <label className="block text-sm font-medium mb-1">End time</label>
        <div className="input bg-brand-soft text-brand-muted select-none">
          {computeEndTime(time, durationMinutes)}
        </div>
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

      <div>
        <label className="block text-sm font-medium mb-1">
          Registration deadline{' '}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <p className="text-xs text-brand-muted mb-1">Closes automatically at this time (Pacific). Auto-set to 7 days before the session.</p>
        <input
          type="datetime-local"
          value={registrationClosesAt}
          onChange={(e) => { setRegistrationClosesAt(e.target.value); setDeadlineTouched(true) }}
          className="w-full sm:max-w-[18rem] input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Early-bird pricing{' '}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <p className="text-xs text-brand-muted mb-1">Charge less for earlier sign-ups; the fee above is the full price.</p>
        <PriceTiersEditor value={priceTiers} onChange={setPriceTiers} />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          No-refund date{' '}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <p className="text-xs text-brand-muted mb-1">Refunds aren&apos;t issued on or after this date.</p>
        <input
          type="date"
          value={noRefundDate}
          onChange={(e) => setNoRefundDate(e.target.value)}
          className="w-full sm:max-w-[18rem] input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">
          Refund policy{' '}
          <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <textarea
          value={refundPolicy}
          onChange={(e) => setRefundPolicy(e.target.value)}
          placeholder="Shown to players before they register."
          rows={3}
          className="input resize-none"
        />
      </div>

      <div>
        <PrizesEditor value={prizes} onChange={setPrizes} />
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
