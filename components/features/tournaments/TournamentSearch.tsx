'use client'

import { useState, useMemo } from 'react'
import TournamentCard from './TournamentCard'
import type { TournamentListItem } from '@/lib/types'

type Props = {
  tournaments: TournamentListItem[]
  isLoggedIn: boolean
}

export default function TournamentSearch({ tournaments, isLoggedIn }: Props) {
  const [q, setQ] = useState('')
  const [regFilter, setRegFilter] = useState<'all' | 'open'>('all')

  const filtered = useMemo(() => {
    return tournaments.filter((t) => {
      if (q.trim() && !t.name.toLowerCase().includes(q.trim().toLowerCase())) return false
      if (regFilter === 'open' && t.registration_status !== 'open') return false
      return true
    })
  }, [tournaments, q, regFilter])

  return (
    <div className="space-y-3">
      {/* Search + filter row */}
      <div className="flex gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tournaments…"
          className="flex-1 input-sm"
        />
        <div className="flex rounded-xl border border-brand-border bg-brand-surface overflow-hidden shrink-0">
          {(['all', 'open'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setRegFilter(opt)}
              className={`px-3 py-2 text-xs font-semibold transition-colors ${
                regFilter === opt ? 'bg-brand-dark text-white' : 'text-brand-muted hover:text-brand-dark'
              }`}
            >
              {opt === 'all' ? 'All' : 'Open'}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-brand-muted text-center py-10">
          No tournaments match your search.
        </p>
      ) : (
        filtered.map((t) => <TournamentCard key={t.id} tournament={t} />)
      )}
    </div>
  )
}
