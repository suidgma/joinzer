'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'

export type StaffEntry = {
  id: string
  user_id: string
  role: 'co_organizer' | 'volunteer'
  created_at: string
  profiles: { id: string; name: string | null; email: string | null } | null
}

type Props = {
  tournamentId: string
  initialStaff: StaffEntry[]
}

const ROLE_LABEL: Record<StaffEntry['role'], string> = {
  co_organizer: 'Co-organizer',
  volunteer: 'Volunteer',
}

export default function StaffManager({ tournamentId, initialStaff }: Props) {
  const router = useRouter()
  const [staff, setStaff] = useState<StaffEntry[]>(initialStaff)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'co_organizer' | 'volunteer'>('co_organizer')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Failed to add')
        return
      }
      setEmail('')
      router.refresh()
    } catch {
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRemove(userId: string) {
    setBusyUserId(userId)
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/staff/${userId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error ?? 'Failed to remove')
        return
      }
      setStaff(prev => prev.filter(s => s.user_id !== userId))
      router.refresh()
    } catch {
      setError('Network error')
    } finally {
      setBusyUserId(null)
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={handleInvite} className="bg-white rounded-xl border border-brand-border p-4 space-y-3">
        <div>
          <label className="block text-xs font-semibold text-brand-muted uppercase tracking-wide mb-1">
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="helper@example.com"
            className="input w-full"
          />
          <p className="text-[11px] text-brand-muted mt-1">
            They must already have a Joinzer account.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-brand-muted uppercase tracking-wide mb-1">
            Role
          </label>
          <div className="flex gap-2">
            {(['co_organizer', 'volunteer'] as const).map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                  role === r
                    ? 'bg-brand-soft border-brand text-brand-active'
                    : 'bg-white border-brand-border text-brand-muted hover:text-brand-dark'
                }`}
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-brand-muted mt-1">
            {role === 'co_organizer'
              ? 'Full management: scoring, scheduling, announcements, withdrawals.'
              : 'Limited: score entry and player check-in only.'}
          </p>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !email.trim()}
          className="w-full py-2.5 rounded-xl bg-brand text-brand-dark font-semibold text-sm hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Adding…' : 'Add to staff'}
        </button>
      </form>

      <div className="bg-white rounded-xl border border-brand-border divide-y divide-brand-border">
        {staff.length === 0 && (
          <p className="px-4 py-8 text-sm text-brand-muted text-center">No staff yet.</p>
        )}
        {staff.map(s => (
          <div key={s.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-brand-dark truncate">
                {s.profiles?.name ?? s.profiles?.email ?? '—'}
              </p>
              {s.profiles?.email && s.profiles.name && (
                <p className="text-[11px] text-brand-muted truncate">{s.profiles.email}</p>
              )}
            </div>
            <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-soft text-brand-active uppercase tracking-wide">
              {ROLE_LABEL[s.role]}
            </span>
            <button
              onClick={() => handleRemove(s.user_id)}
              disabled={busyUserId === s.user_id}
              aria-label="Remove staff member"
              className="shrink-0 p-1.5 rounded-md text-brand-muted hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
