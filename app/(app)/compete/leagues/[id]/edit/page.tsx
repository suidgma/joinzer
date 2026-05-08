'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { formatSessionDate } from '@/lib/utils/date'

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
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

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

export default function EditLeaguePage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [format, setFormat] = useState('mixed_doubles')
  const [skillLevel, setSkillLevel] = useState('intermediate')
  const [locationName, setLocationName] = useState('')
  const [scheduleDescription, setScheduleDescription] = useState('')
  const [startDate, setStartDate] = useState('')
  const [playDays, setPlayDays] = useState('')
  const [gamesPerSession, setGamesPerSession] = useState('')
  const [maxPlayers, setMaxPlayers] = useState('')
  const [registrationStatus, setRegistrationStatus] = useState('upcoming')
  const [status, setStatus] = useState('active')
  const [description, setDescription] = useState('')
  const [costDollars, setCostDollars] = useState('')
  const [existingSessionCount, setExistingSessionCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from('leagues').select('*').eq('id', params.id).single(),
      supabase.from('league_sessions').select('id', { count: 'exact', head: true }).eq('league_id', params.id),
    ]).then(([{ data }, { count }]) => {
      if (!data) return
      setName(data.name ?? '')
      setFormat(data.format ?? 'mixed_doubles')
      setSkillLevel(data.skill_level ?? 'intermediate')
      setLocationName(data.location_name ?? '')
      setScheduleDescription(data.schedule_description ?? '')
      setStartDate(data.start_date ?? '')
      setPlayDays(data.play_days?.toString() ?? '')
      setGamesPerSession(data.games_per_session?.toString() ?? '')
      setMaxPlayers(data.max_players?.toString() ?? '')
      setRegistrationStatus(data.registration_status ?? 'upcoming')
      setStatus(data.status ?? 'active')
      setDescription(data.description ?? '')
      setCostDollars(data.cost_cents ? String(data.cost_cents / 100) : '')
      setExistingSessionCount(count ?? 0)
      setFetching(false)
    })
  }, [params.id])

  const generatedDates = generateDates(startDate, parseInt(playDays) || 0)
  const lastDate = generatedDates[generatedDates.length - 1] ?? ''
  const dayLabel = startDate ? DAYS[new Date(startDate + 'T00:00:00').getDay()] : ''
  const hasNoSessions = existingSessionCount === 0
  const willGenerateSessions = hasNoSessions && generatedDates.length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: updateErr } = await supabase
      .from('leagues')
      .update({
        name: name.trim(),
        format,
        skill_level: skillLevel,
        location_name: locationName.trim() || null,
        schedule_description: scheduleDescription.trim() || null,
        start_date: startDate || null,
        end_date: lastDate || null,
        play_days: playDays ? parseInt(playDays) : null,
        games_per_session: gamesPerSession ? parseInt(gamesPerSession) : null,
        max_players: maxPlayers ? parseInt(maxPlayers) : null,
        registration_status: registrationStatus,
        status,
        description: description.trim() || null,
        cost_cents: costDollars ? Math.round(parseFloat(costDollars) * 100) : 0,
      })
      .eq('id', params.id)

    if (updateErr) { setError(updateErr.message); setLoading(false); return }

    // Generate sessions only if none exist yet
    if (willGenerateSessions) {
      const roundsPerSession = gamesPerSession ? parseInt(gamesPerSession) : 7
      const rows = generatedDates.map((d, i) => ({
        league_id: params.id,
        session_date: d,
        session_number: i + 1,
        rounds_planned: roundsPerSession,
      }))
      await supabase.from('league_sessions').insert(rows)
    }

    window.location.href = `/compete/leagues/${params.id}`
  }

  if (fetching) return <main className="max-w-lg mx-auto p-4"><p className="text-sm text-brand-muted">Loading…</p></main>

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href={`/compete/leagues/${params.id}`} className="text-brand-muted text-sm">← Back</Link>
      </div>
      <h1 className="font-heading text-xl font-bold text-brand-dark">Edit League</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="League Name *">
          <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full input" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Format">
            <select value={format} onChange={(e) => setFormat(e.target.value)} className="w-full input">
              {FORMAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Skill Level">
            <select value={skillLevel} onChange={(e) => setSkillLevel(e.target.value)} className="w-full input">
              {SKILL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Registration">
            <select value={registrationStatus} onChange={(e) => setRegistrationStatus(e.target.value)} className="w-full input">
              {REG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full input">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Location">
          <input value={locationName} onChange={(e) => setLocationName(e.target.value)} className="w-full input" />
        </Field>
        <Field label="Schedule Description">
          <input value={scheduleDescription} onChange={(e) => setScheduleDescription(e.target.value)} className="w-full input" />
        </Field>
        <Field label="Start Date">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full input" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Play Days"><input type="number" min="1" value={playDays} onChange={(e) => setPlayDays(e.target.value)} className="w-full input" /></Field>
          <Field label="Games/Play"><input type="number" min="1" value={gamesPerSession} onChange={(e) => setGamesPerSession(e.target.value)} className="w-full input" /></Field>
          <Field label="Max Players"><input type="number" min="2" value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} className="w-full input" /></Field>
        </div>

        {/* Session preview — only shown when no sessions exist yet */}
        {hasNoSessions && (
          generatedDates.length > 0 ? (
            <div className="bg-brand-soft border border-brand-border rounded-xl p-3 space-y-1.5">
              <p className="text-xs font-semibold text-brand-dark">
                {generatedDates.length} sessions · every {dayLabel}
              </p>
              <div className="space-y-0.5 max-h-40 overflow-y-auto">
                {generatedDates.map((d, i) => (
                  <p key={d} className="text-xs text-brand-muted">
                    Play {i + 1} — {formatSessionDate(d)}
                  </p>
                ))}
              </div>
              <p className="text-xs text-brand-active font-medium">These sessions will be created when you save.</p>
            </div>
          ) : (
            <p className="text-xs text-brand-muted">Set a start date and number of play days to auto-generate the session schedule.</p>
          )
        )}

        <Field label="Registration Fee (optional)">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted text-sm">$</span>
            <input
              type="number"
              min="0"
              step="1"
              value={costDollars}
              onChange={(e) => setCostDollars(e.target.value)}
              placeholder="0"
              className="w-full input pl-7"
            />
          </div>
        </Field>

        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full input resize-none" />
        </Field>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={loading || !name.trim()} className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors">
          {loading ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-brand-dark mb-1">{label}</label>
      {children}
    </div>
  )
}
