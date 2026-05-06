'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatSessionDate } from '@/lib/utils/date'

type Session = {
  id: string
  session_number: number
  session_date: string
  status: string
  notes: string | null
}

type Props = {
  leagueId: string
  sessions: Session[]
}

export default function SessionScheduleManager({ leagueId, sessions: initial }: Props) {
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[]>(initial)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function startEdit(s: Session) {
    setEditingId(s.id)
    setEditDate(s.session_date)
    setError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setError(null)
  }

  async function deleteSession(sessionId: string) {
    if (!confirm('Delete this session? This cannot be undone.')) return
    setDeletingId(sessionId)
    const res = await fetch(`/api/league-sessions/${sessionId}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json()
      setError(d.error ?? 'Failed to delete session')
      setDeletingId(null)
      return
    }
    setSessions((prev) => prev.filter((s) => s.id !== sessionId))
    setDeletingId(null)
  }

  async function saveEdit(sessionId: string) {
    setSaving(true)
    setError(null)
    const res = await fetch(`/api/league-sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_date: editDate }),
    })
    if (!res.ok) {
      const d = await res.json()
      setError(d.error ?? 'Failed to save')
      setSaving(false)
      return
    }
    setSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, session_date: editDate } : s))
    setEditingId(null)
    setSaving(false)
    router.refresh()
  }

  return (
    <div className="space-y-2">
      {sessions.map((s) => {
        const dateStr = formatSessionDate(s.session_date)
        const isEditing = editingId === s.id

        return (
          <div key={s.id} className="bg-brand-surface border border-brand-border rounded-xl p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <div className="space-y-2">
                    <p className="text-xs text-brand-muted font-medium">Session {s.session_number}</p>
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="input text-sm w-full"
                    />
                    {error && <p className="text-xs text-red-600">{error}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit(s.id)}
                        disabled={saving}
                        className="flex-1 py-1.5 rounded-lg bg-brand text-brand-dark text-xs font-semibold disabled:opacity-50"
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        disabled={saving}
                        className="flex-1 py-1.5 rounded-lg border border-brand-border text-xs text-brand-muted"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium text-brand-dark">
                      Session {s.session_number} — {dateStr}
                    </p>
                    {s.notes && <p className="text-xs text-brand-muted">{s.notes}</p>}
                    <div className="flex gap-3 mt-1 flex-wrap">
                      {(s.status === 'completed' || s.status === 'in_progress') && (
                        <Link href={`/compete/leagues/${leagueId}/sessions/${s.id}/results`} className="text-xs text-brand-active underline underline-offset-2">
                          Results →
                        </Link>
                      )}
                      {s.status === 'in_progress' && (
                        <Link href={`/compete/leagues/${leagueId}/sessions/${s.id}/live`} className="text-xs text-brand-active underline underline-offset-2">
                          Live →
                        </Link>
                      )}
                      {s.status === 'scheduled' && (
                        <Link href={`/compete/leagues/${leagueId}/sessions/${s.id}/results`} className="text-xs text-brand-muted underline underline-offset-2">
                          Enter results →
                        </Link>
                      )}
                      <button
                        onClick={() => startEdit(s)}
                        className="text-xs text-brand-muted underline underline-offset-2 hover:text-brand-active"
                      >
                        Edit date
                      </button>
                      <button
                        onClick={() => deleteSession(s.id)}
                        disabled={deletingId === s.id}
                        className="text-xs text-red-500 underline underline-offset-2 hover:text-red-700 disabled:opacity-40"
                      >
                        {deletingId === s.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </>
                )}
              </div>
              {!isEditing && (
                <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${
                  s.status === 'completed' ? 'bg-brand-soft text-brand-muted' :
                  s.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                  s.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                  'bg-brand text-brand-dark'
                }`}>{s.status.replace('_', ' ')}</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
