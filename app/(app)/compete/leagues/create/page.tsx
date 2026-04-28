'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

const FORMAT_OPTIONS = [
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

export default function CreateLeaguePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [format, setFormat] = useState('mixed_doubles')
  const [skillLevel, setSkillLevel] = useState('intermediate')
  const [locationName, setLocationName] = useState('')
  const [scheduleDescription, setScheduleDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [playDays, setPlayDays] = useState('')
  const [gamesPerSession, setGamesPerSession] = useState('')
  const [maxPlayers, setMaxPlayers] = useState('')
  const [registrationStatus, setRegistrationStatus] = useState('upcoming')
  const [description, setDescription] = useState('')
  const [sessionDates, setSessionDates] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        location_name: locationName.trim() || null,
        schedule_description: scheduleDescription.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
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

    // Create session rows from comma/newline separated dates
    const dates = sessionDates
      .split(/[\n,]+/)
      .map((d) => d.trim())
      .filter(Boolean)

    if (dates.length > 0) {
      const rows = dates.map((d, i) => ({
        league_id: league.id,
        session_date: d,
        session_number: i + 1,
      }))
      await supabase.from('league_sessions').insert(rows)
    }

    router.push(`/compete/leagues/${league.id}`)
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/compete" className="text-brand-muted text-sm">← Compete</Link>
      </div>
      <h1 className="font-heading text-xl font-bold text-brand-dark">Create League</h1>

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
          <input value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder="e.g. Sunset Park Pickleball Courts" className="w-full input" />
        </Field>

        <Field label="Schedule Description">
          <input value={scheduleDescription} onChange={(e) => setScheduleDescription(e.target.value)} placeholder="e.g. Wednesdays 6–9 PM" className="w-full input" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start Date">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full input" />
          </Field>
          <Field label="End Date">
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full input" />
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

        <Field label="Session Dates" hint="One date per line (YYYY-MM-DD) or comma separated">
          <textarea
            value={sessionDates}
            onChange={(e) => setSessionDates(e.target.value)}
            placeholder={'2026-05-07\n2026-05-14\n2026-05-21'}
            rows={4}
            className="w-full input resize-none"
          />
        </Field>

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
    </main>
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
