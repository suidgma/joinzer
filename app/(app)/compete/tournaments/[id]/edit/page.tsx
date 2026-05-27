'use client'

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import type { LocationOption } from '@/lib/types'

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default function EditTournamentPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const router = useRouter()
  const [name, setName] = useState('')
  const [locationId, setLocationId] = useState('')
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [regOpen, setRegOpen] = useState('')
  const [regClose, setRegClose] = useState('')
  const [costDollars, setCostDollars] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('draft')
  const [fetching, setFetching] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from('tournaments').select('*').eq('id', params.id).single(),
      supabase.from('locations').select('id, name, subarea, court_count').order('court_count', { ascending: false }).order('name'),
    ]).then(([{ data }, { data: locs }]) => {
      if (data) {
        setName(data.name ?? '')
        setLocationId(data.location_id ?? '')
        setStartDate(data.start_date ?? '')
        setEndDate(data.end_date ?? '')
        setRegOpen(data.registration_open ?? '')
        setRegClose(data.registration_close ?? '')
        setCostDollars(data.cost_cents ? (data.cost_cents / 100).toString() : '')
        setDescription(data.description ?? '')
        setStatus(data.status ?? 'draft')
      }
      setLocations((locs ?? []) as LocationOption[])
      setFetching(false)
    })
  }, [params.id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: updateErr } = await supabase
      .from('tournaments')
      .update({
        name: name.trim(),
        location_id: locationId || null,
        start_date: startDate || null,
        end_date: endDate || null,
        registration_open: regOpen || null,
        registration_close: regClose || null,
        cost_cents: costDollars ? Math.round(parseFloat(costDollars) * 100) : 0,
        description: description.trim() || null,
        status,
      })
      .eq('id', params.id)

    if (updateErr) { setError(updateErr.message); setLoading(false); return }
    router.push(`/compete/tournaments/${params.id}`)
  }

  if (fetching) return <main className="max-w-lg mx-auto p-4"><p className="text-sm text-brand-muted">Loading…</p></main>

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href={`/compete/tournaments/${params.id}`} className="text-brand-muted text-sm">← Tournament</Link>
      </div>
      <h1 className="font-heading text-xl font-bold text-brand-dark">Edit Tournament</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Tournament Name *">
          <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full input" />
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full input">
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start Date"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full input" /></Field>
          <Field label="End Date"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full input" /></Field>
          <Field label="Reg. Opens"><input type="date" value={regOpen} onChange={(e) => setRegOpen(e.target.value)} className="w-full input" /></Field>
          <Field label="Reg. Closes"><input type="date" value={regClose} onChange={(e) => setRegClose(e.target.value)} className="w-full input" /></Field>
        </div>
        <Field label="Entry Fee ($)">
          <input type="number" min="0" step="5" value={costDollars} onChange={(e) => setCostDollars(e.target.value)} placeholder="0" className="w-full input" />
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
