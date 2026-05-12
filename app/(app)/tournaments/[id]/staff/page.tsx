'use client'
import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Trash2, UserPlus } from 'lucide-react'
import Link from 'next/link'

type StaffMember = {
  id: string
  user_id: string
  role: string
  created_at: string
  profiles: { name: string } | null
}

export default function StaffPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const tournamentId = params.id

  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'co_organizer' | 'volunteer'>('co_organizer')
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/tournaments/${tournamentId}/staff`)
      .then(r => r.json())
      .then(j => { setStaff(j.staff ?? []); setLoading(false) })
      .catch(() => { setLoading(false) })
  }, [tournamentId])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setError(null)
    setSuccess(null)
    const res = await fetch(`/api/tournaments/${tournamentId}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? 'Failed'); setInviting(false); return }
    setStaff(prev => [...prev, json.staff])
    setEmail('')
    setSuccess(`${email} added as ${role === 'co_organizer' ? 'Co-organizer' : 'Volunteer'}.`)
    setInviting(false)
  }

  async function handleRemove(staffId: string) {
    if (!confirm('Remove this staff member?')) return
    const res = await fetch(`/api/tournaments/${tournamentId}/staff?id=${staffId}`, { method: 'DELETE' })
    if (res.ok) setStaff(prev => prev.filter(s => s.id !== staffId))
  }

  const ROLE_LABELS: Record<string, string> = {
    co_organizer: 'Co-organizer',
    volunteer: 'Volunteer',
  }

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
        <div>
          <label className="block text-xs font-medium text-brand-muted mb-1">Email address</label>
          <input
            required
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="player@email.com"
            className="w-full input"
          />
        </div>
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
          disabled={inviting}
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
