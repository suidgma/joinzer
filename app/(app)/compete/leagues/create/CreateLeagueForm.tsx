'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { LocationOption } from '@/lib/types'

const FORMAT_OPTIONS = [
  { value: 'individual_round_robin', label: 'Individual Round Robin' },
  { value: 'mens_doubles', label: "Men's Doubles" },
  { value: 'womens_doubles', label: "Women's Doubles" },
  { value: 'mixed_doubles', label: 'Mixed Doubles' },
  { value: 'coed_doubles', label: 'Coed Doubles' },
  { value: 'singles', label: 'Singles' },
  { value: 'custom', label: 'Custom' },
]

const SKILL_OPTIONS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'beginner_plus', label: 'Beginner+' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'intermediate_plus', label: 'Intermediate+' },
  { value: 'advanced', label: 'Advanced' },
]

const REG_OPTIONS = [
  { value: 'upcoming', label: 'Coming Soon' },
  { value: 'open', label: 'Open' },
  { value: 'waitlist_only', label: 'Waitlist Only' },
  { value: 'closed', label: 'Closed' },
]

export default function CreateLeagueForm({ locations }: { locations: LocationOption[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [format, setFormat] = useState('mixed_doubles')
  const [skillLevel, setSkillLevel] = useState('intermediate')
  const [locationId, setLocationId] = useState('')
  const [scheduleDescription, setScheduleDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [playDays, setPlayDays] = useState('7')
  const [gamesPerSession, setGamesPerSession] = useState('')
  const [maxPlayers, setMaxPlayers] = useState('')
  const [registrationStatus, setRegistrationStatus] = useState('upcoming')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedLocation = locations.find((l) => l.id === locationId)

  // Auto-generate weekly session dates from startDate + playDays
  function generateDates(start: string, count: number): string[] {
    if (!start || !count || count < 1) return []
    const dates: string[] = []
    const base = new Date(start + 'T00:00:00')
    for (let i = 0; i < count; i++) {
      const d = new Date(base)
      d.setDate(base.getDate() + i * 7)
      dates.push(d.toISOString().slice(0, 10))
    }
    return dates
  }

  const generatedDates = generateDates(startDate, parseInt(playDays) || 0)
  const lastDate = generatedDates[generatedDates.length - 1] ?? ''

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const dayLabel = startDate ? DAYS[new Date(startDate + 'T00:00:00').getDay()] : ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: league, error: leagueErr } = await supabase
      .from('leagues')
      .insert({
        name: name.trim(),
        format,
        skill_level: skillLevel,
        location_name: selectedLocation?.name ?? null,
        schedule_description: scheduleDescription.trim() || null,
        start_date: startDate || null,
        end_date: endDate || lastDate || null,
        play_days: playDays ? parseInt(playDays) : null,
        games_per_session: gamesPerSession ? parseInt(gamesPerSession) : null,
        max_players: maxPlayers ? parseInt(maxPlayers) : null,
        registration_status: registrationStatus,
        description: description.trim() || null,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (leagueErr || !league) {
      setError(leagueErr?.message ?? 'Failed to create league')
      setLoading(false)
      return
    }

    if (generatedDates.length > 0) {
      const rows = generatedDates.map((d, i) => ({
        league_id: league.id,
        session_date: d,
        session_number: i + 1,
      }))
      await supabase.from('league_sessions').insert(rows)
    }

    router.push(`/compete/leagues/${league.id}`)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="League Name *">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wednesday Night Mixed Doubles" className="w-full input" />
      </Field>

      <Field label="Format *">
        <select value={format} onChange={(e) => setFormat(e.target.value)} className="w-full input">
          {FORMAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>

      <Field label="Skill Level *">
        <select value={skillLevel} onChange={(e) => setSkillLevel(e.target.value)} className="w-full input">
          {SKILL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>

      <Field label="Registration Status">
        <select value={registrationStatus} onChange={(e) => setRegistrationStatus(e.target.value)} className="w-full input">
          {REG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>

      <Field label="Location">
        <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-full input">
          <option value="">— Select a location —</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}{l.subarea ? ` (${l.subarea})` : ''} · {l.court_count} courts
            </option>
          ))}
        </select>
      </Field>

      <Field label="Schedule Description">
        <input value={scheduleDescription} onChange={(e) => setScheduleDescription(e.target.value)} placeholder="e.g. Wednesdays 6–9 PM" className="w-full input" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Start Date">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full input" />
        </Field>
        <Field label="End Date">
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder={lastDate || undefined} className="w-full input" />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Play Days">
          <input type="number" min="1" value={playDays} onChange={(e) => setPlayDays(e.target.value)} placeholder="8" className="w-full input" />
        </Field>
        <Field label="Games/Session">
          <input type="number" min="1" value={gamesPerSession} onChange={(e) => setGamesPerSession(e.target.value)} placeholder="7" className="w-full input" />
        </Field>
        <Field label="Max Players">
          <input type="number" min="2" value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} placeholder="16" className="w-full input" />
        </Field>
      </div>

      {/* Auto-generated schedule preview */}
      {generatedDates.length > 0 ? (
        <div className="bg-brand-soft border border-brand-border rounded-xl p-3 space-y-1.5">
          <p className="text-xs font-semibold text-brand-dark">
            {generatedDates.length} sessions · every {dayLabel}
          </p>
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {generatedDates.map((d, i) => (
              <p key={d} className="text-xs text-brand-muted">
                Session {i + 1} — {new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </p>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-brand-muted">Set a start date and number of play days to auto-generate the session schedule.</p>
      )}

      <Field label="Description">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Additional details about the league…" className="w-full input resize-none" />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading || !name.trim()}
        className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
      >
        {loading ? 'Creating…' : 'Create League'}
      </button>
    </form>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-brand-dark mb-1">{label}</label>
      {hint && <p className="text-xs text-brand-muted mb-1">{hint}</p>}
      {children}
    </div>
  )
}
