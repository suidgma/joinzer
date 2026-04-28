'use client'

import { useState, useEffect } from 'react'
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
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default function EditLeaguePage({ params }: { params: { id: string } }) {
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
  const [status, setStatus] = useState('active')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.from('leagues').select('*').eq('id', params.id).single().then(({ data }) => {
      if (!data) return
      setName(data.name ?? '')
      setFormat(data.format ?? 'mixed_doubles')
      setSkillLevel(data.skill_level ?? 'intermediate')
      setLocationName(data.location_name ?? '')
      setScheduleDescription(data.schedule_description ?? '')
      setStartDate(data.start_date ?? '')
      setEndDate(data.end_date ?? '')
      setPlayDays(data.play_days?.toString() ?? '')
      setGamesPerSession(data.games_per_session?.toString() ?? '')
      setMaxPlayers(data.max_players?.toString() ?? '')
      setRegistrationStatus(data.registration_status ?? 'upcoming')
      setStatus(data.status ?? 'active')
      setDescription(data.description ?? '')
      setFetching(false)
    })
  }, [params.id])

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
        end_date: endDate || null,
        play_days: playDays ? parseInt(playDays) : null,
        games_per_session: gamesPerSession ? parseInt(gamesPerSession) : null,
        max_players: maxPlayers ? parseInt(maxPlayers) : null,
        registration_status: registrationStatus,
        status,
        description: description.trim() || null,
      })
      .eq('id', params.id)

    if (updateErr) { setError(updateErr.message); setLoading(false); return }
    router.push(`/compete/leagues/${params.id}`)
  }

  if (fetching) return <main className="max-w-lg mx-auto p-4"><p className="text-sm text-brand-muted">Loading…</p></main>

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href={`/compete/leagues/${params.id}`} className="text-brand-muted text-sm">← League</Link>
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start Date"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full input" /></Field>
          <Field label="End Date"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full input" /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Play Days"><input type="number" min="1" value={playDays} onChange={(e) => setPlayDays(e.target.value)} className="w-full input" /></Field>
          <Field label="Games/Session"><input type="number" min="1" value={gamesPerSession} onChange={(e) => setGamesPerSession(e.target.value)} className="w-full input" /></Field>
          <Field label="Max Players"><input type="number" min="2" value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} className="w-full input" /></Field>
        </div>
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
