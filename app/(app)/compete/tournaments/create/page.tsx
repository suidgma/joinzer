'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

const CATEGORY_OPTIONS = [
  { value: 'mens_singles', label: "Men's Singles" },
  { value: 'womens_singles', label: "Women's Singles" },
  { value: 'mens_doubles', label: "Men's Doubles" },
  { value: 'womens_doubles', label: "Women's Doubles" },
  { value: 'mixed_doubles', label: 'Mixed Doubles' },
]

const BRACKET_OPTIONS = [
  { value: 'single_elimination', label: 'Single Elimination' },
  { value: 'double_elimination', label: 'Double Elimination' },
  { value: 'round_robin', label: 'Round Robin' },
  { value: 'pool_play', label: 'Pool Play' },
]

type EventDraft = {
  name: string
  category: string
  skill_level: string
  age_division: string
  max_teams: string
  event_date: string
  bracket_type: string
}

function blankEvent(): EventDraft {
  return { name: '', category: 'mixed_doubles', skill_level: '', age_division: '', max_teams: '', event_date: '', bracket_type: 'single_elimination' }
}

export default function CreateTournamentPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [locationName, setLocationName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [regOpen, setRegOpen] = useState('')
  const [regClose, setRegClose] = useState('')
  const [costDollars, setCostDollars] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('upcoming')
  const [events, setEvents] = useState<EventDraft[]>([blankEvent()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateEvent(i: number, field: keyof EventDraft, value: string) {
    setEvents((prev) => prev.map((e, idx) => idx === i ? { ...e, [field]: value } : e))
  }

  function addEvent() { setEvents((prev) => [...prev, blankEvent()]) }
  function removeEvent(i: number) { setEvents((prev) => prev.filter((_, idx) => idx !== i)) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: tournament, error: tErr } = await supabase
      .from('tournaments')
      .insert({
        name: name.trim(),
        location_name: locationName.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
        registration_open: regOpen || null,
        registration_close: regClose || null,
        cost_cents: costDollars ? Math.round(parseFloat(costDollars) * 100) : 0,
        description: description.trim() || null,
        status,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (tErr || !tournament) {
      setError(tErr?.message ?? 'Failed to create tournament')
      setLoading(false)
      return
    }

    const validEvents = events.filter((ev) => ev.name.trim())
    if (validEvents.length > 0) {
      await supabase.from('tournament_events').insert(
        validEvents.map((ev) => ({
          tournament_id: tournament.id,
          name: ev.name.trim(),
          category: ev.category,
          skill_level: ev.skill_level.trim() || null,
          age_division: ev.age_division.trim() || null,
          max_teams: ev.max_teams ? parseInt(ev.max_teams) : null,
          event_date: ev.event_date || null,
          bracket_type: ev.bracket_type,
        }))
      )
    }

    router.push(`/compete/tournaments/${tournament.id}`)
  }

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/compete" className="text-brand-muted text-sm">← Compete</Link>
      </div>
      <h1 className="font-heading text-xl font-bold text-brand-dark">Create Tournament</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Tournament Name *">
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Vegas Pickleball Open 2026" className="w-full input" />
        </Field>

        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full input">
            <option value="upcoming">Coming Soon</option>
            <option value="registration_open">Registration Open</option>
            <option value="registration_closed">Registration Closed</option>
          </select>
        </Field>

        <Field label="Location">
          <input value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder="e.g. Darling Tennis Center" className="w-full input" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start Date"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full input" /></Field>
          <Field label="End Date"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full input" /></Field>
          <Field label="Reg. Opens"><input type="date" value={regOpen} onChange={(e) => setRegOpen(e.target.value)} className="w-full input" /></Field>
          <Field label="Reg. Closes"><input type="date" value={regClose} onChange={(e) => setRegClose(e.target.value)} className="w-full input" /></Field>
        </div>

        <Field label="Entry Fee per Event ($)">
          <input type="number" min="0" step="5" value={costDollars} onChange={(e) => setCostDollars(e.target.value)} placeholder="0" className="w-full input" />
        </Field>

        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Details, rules, contact info…" className="w-full input resize-none" />
        </Field>

        {/* Events / divisions */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-brand-dark">Events / Divisions</h2>
          {events.map((ev, i) => (
            <div key={i} className="bg-brand-soft border border-brand-border rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-brand-muted">Event {i + 1}</span>
                {events.length > 1 && (
                  <button type="button" onClick={() => removeEvent(i)} className="text-xs text-red-500">Remove</button>
                )}
              </div>
              <input placeholder="Event name *" value={ev.name} onChange={(e) => updateEvent(i, 'name', e.target.value)} className="w-full input text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <select value={ev.category} onChange={(e) => updateEvent(i, 'category', e.target.value)} className="input text-sm">
                  {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <select value={ev.bracket_type} onChange={(e) => updateEvent(i, 'bracket_type', e.target.value)} className="input text-sm">
                  {BRACKET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <input placeholder="Skill level (e.g. 3.5)" value={ev.skill_level} onChange={(e) => updateEvent(i, 'skill_level', e.target.value)} className="input text-sm" />
                <input placeholder="Age division (optional)" value={ev.age_division} onChange={(e) => updateEvent(i, 'age_division', e.target.value)} className="input text-sm" />
                <input type="number" placeholder="Max teams" value={ev.max_teams} onChange={(e) => updateEvent(i, 'max_teams', e.target.value)} className="input text-sm" />
                <input type="date" value={ev.event_date} onChange={(e) => updateEvent(i, 'event_date', e.target.value)} className="input text-sm" />
              </div>
            </div>
          ))}
          <button type="button" onClick={addEvent} className="text-sm text-brand-active font-medium underline underline-offset-2">
            + Add another event
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
        >
          {loading ? 'Creating…' : 'Create Tournament'}
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
