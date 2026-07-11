'use client'

import { useMemo, useState } from 'react'

export type VenueRow = {
  id: string
  name: string
  place: string
  shortCode: string
  autoCode: string
}

export default function VenueCodesList({ initial }: { initial: VenueRow[] }) {
  const [rows, setRows] = useState(initial)
  const [drafts, setDrafts] = useState<Record<string, string>>(
    () => Object.fromEntries(initial.map((v) => [v.id, v.shortCode])),
  )
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? rows.filter((v) => v.name.toLowerCase().includes(q)) : rows
  }, [rows, query])

  async function save(id: string) {
    const value = (drafts[id] ?? '').trim()
    setSavingId(id)
    setError(null)
    setSavedId(null)
    try {
      const res = await fetch(`/api/admin/locations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ short_code: value }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d.error ?? 'Save failed')
        return
      }
      const saved = (d.short_code ?? '') as string
      setRows((prev) => prev.map((v) => (v.id === id ? { ...v, shortCode: saved } : v)))
      setDrafts((prev) => ({ ...prev, [id]: saved }))
      setSavedId(id)
    } catch {
      setError('Network error — please retry')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search venues…"
        className="w-full input text-sm"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="space-y-1.5">
        {filtered.map((v) => {
          const dirty = (drafts[v.id] ?? '') !== v.shortCode
          return (
            <div key={v.id} className="flex items-center gap-3 border border-brand-border rounded-xl px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-brand-dark truncate">{v.name}</p>
                {v.place && <p className="text-[11px] text-brand-muted">{v.place}</p>}
              </div>
              <input
                value={drafts[v.id] ?? ''}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [v.id]: e.target.value.toUpperCase().slice(0, 12) }))}
                placeholder={v.autoCode}
                aria-label={`Map code for ${v.name}`}
                className="w-24 input text-sm text-center"
                maxLength={12}
              />
              <button
                type="button"
                onClick={() => save(v.id)}
                disabled={!dirty || savingId === v.id}
                className="px-3 py-1.5 rounded-lg bg-brand text-brand-dark text-xs font-semibold hover:bg-brand-hover disabled:opacity-40 transition-colors"
              >
                {savingId === v.id ? '…' : savedId === v.id && !dirty ? 'Saved' : 'Save'}
              </button>
            </div>
          )
        })}
      </div>
      {filtered.length === 0 && <p className="text-sm text-brand-muted">No venues match.</p>}
    </div>
  )
}
