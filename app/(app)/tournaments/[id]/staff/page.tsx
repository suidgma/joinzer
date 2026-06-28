'use client'
import { useState, useEffect, useRef } from 'react'
import { useDialog } from '@/components/ui/DialogProvider'
import { useParams } from 'next/navigation'
import { Trash2, UserPlus } from 'lucide-react'
import Link from 'next/link'

type StaffMember = {
  id: string
  user_id: string
  role: string
  created_at: string
  profiles: { name: string } | null
}

type Player = {
  id: string
  name: string
  email: string
}

export default function StaffPage() {
  const { confirm } = useDialog()
  const params = useParams<{ id: string }>()
  const tournamentId = params.id

  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<'co_organizer' | 'volunteer'>('co_organizer')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Player picker state
  const [players, setPlayers] = useState<Player[]>([])
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null)
  const [query, setQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const comboboxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/tournaments/${tournamentId}/staff`)
      .then(r => r.json())
      .then(j => { setStaff(j.staff ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [tournamentId])

  useEffect(() => {
    fetch('/api/players')
      .then(r => r.json())
      .then(j => setPlayers(j.players ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredPlayers = query.trim()
    ? players.filter(p =>
        p.name.toLowerCase().includes(query.toLowerCase()) ||
        p.email.toLowerCase().includes(query.toLowerCase())
      )
    : players

  function handleSelectPlayer(p: Player) {
    setSelectedPlayer(p)
    setQuery('')
    setDropdownOpen(false)
    setError(null)
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedPlayer) { setError('Please select a player'); return }
    setInviting(true)
    setError(null)
    setSuccess(null)
    const res = await fetch(`/api/tournaments/${tournamentId}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: selectedPlayer.email, role }),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? 'Failed'); setInviting(false); return }
    setStaff(prev => [...prev, json.staff])
    setSuccess(`${selectedPlayer.name} added as ${role === 'co_organizer' ? 'Co-organizer' : 'Volunteer'}.`)
    setSelectedPlayer(null)
    setQuery('')
    setInviting(false)
  }

  async function handleRemove(staffId: string) {
    if (!(await confirm({ title: 'Remove staff member?', body: 'Remove this staff member?', confirmLabel: 'Remove', danger: true }))) return
    const res = await fetch(`/api/tournaments/${tournamentId}/staff?id=${staffId}`, { method: 'DELETE' })
    if (res.ok) setStaff(prev => prev.filter(s => s.id !== staffId))
  }

  const ROLE_LABELS: Record<string, string> = {
    co_organizer: 'Co-organizer',
    volunteer: 'Volunteer',
  }

  const inputDisplay = selectedPlayer && !dropdownOpen ? selectedPlayer.name : query

  return (
    <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/tournaments/${tournamentId}`} className="text-sm text-brand-muted hover:text-brand-dark">← Back</Link>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Staff & Roles</h1>
      </div>

      {/* Invite form */}
      <form onSubmit={handleInvite} className="bg-white border border-brand-border rounded-2xl p-5 space-y-3">
        <h2 className="font-heading text-sm font-bold text-brand-dark flex items-center gap-2">
          <UserPlus size={15} /> Add Staff Member
        </h2>

        {/* Player combobox */}
        <div>
          <div ref={comboboxRef} className="relative">
            <input
              type="text"
              value={inputDisplay}
              onChange={e => {
                setQuery(e.target.value)
                setSelectedPlayer(null)
                setDropdownOpen(true)
              }}
              onFocus={() => {
                setQuery('')
                setDropdownOpen(true)
              }}
              placeholder="Search by name or email…"
              autoComplete="off"
              className="w-full input"
            />
            {dropdownOpen && (
              <ul className="absolute z-10 mt-1 w-full bg-brand-surface border border-brand-border rounded-xl shadow-lg max-h-48 overflow-auto">
                {filteredPlayers.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-brand-muted">No players found</li>
                ) : (
                  filteredPlayers.slice(0, 30).map(p => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onMouseDown={() => handleSelectPlayer(p)}
                        className="w-full text-left px-3 py-2 hover:bg-brand-soft transition-colors"
                      >
                        <span className="text-sm font-medium text-brand-dark">{p.name}</span>
                        <span className="text-xs text-brand-muted ml-2">{p.email}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          {selectedPlayer && (
            <p className="mt-1 text-xs text-brand-muted">{selectedPlayer.email}</p>
          )}
        </div>

        {/* Role selector */}
        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1">Role</label>
          <div className="flex rounded-xl border border-brand-border overflow-hidden">
            {([
              { value: 'co_organizer', label: 'Co-organizer', desc: 'Full access except delete' },
              { value: 'volunteer', label: 'Volunteer', desc: 'Score entry only' },
            ] as const).map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRole(opt.value)}
                className={`flex-1 py-2 px-3 text-xs font-semibold transition-colors text-left ${
                  role === opt.value ? 'bg-brand-dark text-white' : 'text-brand-muted hover:text-brand-dark'
                }`}
              >
                <div>{opt.label}</div>
                <div className={`text-[10px] font-normal mt-0.5 ${role === opt.value ? 'text-white/70' : 'text-brand-muted'}`}>
                  {opt.desc}
                </div>
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        {success && <p className="text-xs text-green-600">{success}</p>}

        <button
          type="submit"
          disabled={inviting || !selectedPlayer}
          className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
        >
          {inviting ? 'Adding…' : 'Add Staff Member'}
        </button>
      </form>

      {/* Staff list */}
      <div className="space-y-2">
        <h2 className="text-[11px] font-bold text-brand-muted uppercase tracking-widest">Current Staff</h2>
        {loading && <p className="text-sm text-brand-muted">Loading…</p>}
        {!loading && staff.length === 0 && (
          <p className="text-sm text-brand-muted">No staff added yet.</p>
        )}
        {staff.map(s => (
          <div key={s.id} className="flex items-center justify-between bg-white border border-brand-border rounded-xl px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-brand-dark">{(s.profiles as any)?.name ?? '—'}</p>
              <p className="text-xs text-brand-muted">{ROLE_LABELS[s.role] ?? s.role}</p>
            </div>
            <button
              onClick={() => handleRemove(s.id)}
              className="p-1.5 text-brand-muted hover:text-red-600 transition-colors"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </main>
  )
}
