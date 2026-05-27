'use client'
import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { OrgDivision, OrgRegistration } from './types'

type Props = {
  tournamentId: string
  divisions: OrgDivision[]
  registrations: OrgRegistration[]
  onClose: () => void
  onSent: () => void
}

export default function AnnounceModal({
  tournamentId, divisions, registrations, onClose, onSent,
}: Props) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Default: all divisions selected (sends to everyone, matches old behavior)
  const [selectedDivisionIds, setSelectedDivisionIds] = useState<Set<string>>(
    () => new Set(divisions.map(d => d.id))
  )

  function toggleDivision(id: string) {
    setSelectedDivisionIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function selectAll() { setSelectedDivisionIds(new Set(divisions.map(d => d.id))) }
  function clearAll() { setSelectedDivisionIds(new Set()) }

  const recipientCount = useMemo(() => {
    const regs = registrations.filter(r =>
      r.status === 'registered' && selectedDivisionIds.has(r.division_id)
    )
    const ids = new Set<string>()
    for (const r of regs) {
      if (r.user_id) ids.add(r.user_id)
      if (r.partner_user_id) ids.add(r.partner_user_id)
    }
    return ids.size
  }, [registrations, selectedDivisionIds])

  const allSelected = selectedDivisionIds.size === divisions.length
  const noneSelected = selectedDivisionIds.size === 0

  async function handleSend() {
    if (!subject.trim() || !body.trim() || noneSelected || recipientCount === 0) return
    setSending(true)
    setError(null)
    try {
      // Omit division_ids when all selected — sends to everyone (server treats absent filter as "all")
      const payload: Record<string, unknown> = { subject, body }
      if (!allSelected) payload.division_ids = Array.from(selectedDivisionIds)

      const res = await fetch(`/api/tournaments/${tournamentId}/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to send'); return }
      onSent()
      onClose()
    } catch {
      setError('Network error — please try again')
    } finally {
      setSending(false)
    }
  }

  const canSend =
    subject.trim().length > 0 && body.trim().length > 0 &&
    !sending && !noneSelected && recipientCount > 0

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-end justify-center sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base font-bold text-brand-dark">Email players</h2>
          <button onClick={onClose} className="p-1 text-brand-muted hover:text-brand-dark">
            <X size={18} />
          </button>
        </div>

        {divisions.length > 1 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
                Send to
              </label>
              <div className="flex gap-3 text-xs">
                <button onClick={selectAll} className="text-brand-active font-semibold hover:underline">
                  All
                </button>
                <button onClick={clearAll} className="text-brand-muted hover:text-brand-dark">
                  None
                </button>
              </div>
            </div>
            <div className="space-y-1.5 max-h-44 overflow-y-auto rounded-lg border border-brand-border bg-brand-soft p-2">
              {divisions.map(d => (
                <label
                  key={d.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-white"
                >
                  <input
                    type="checkbox"
                    checked={selectedDivisionIds.has(d.id)}
                    onChange={() => toggleDivision(d.id)}
                    className="accent-brand-active"
                  />
                  <span className="text-sm text-brand-dark">{d.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Subject line…"
          className="input w-full"
          autoFocus
        />
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Your message…"
          rows={4}
          className="input resize-none w-full"
        />

        {error && <p className="text-xs text-red-600">{error}</p>}
        {noneSelected && (
          <p className="text-xs text-brand-muted">Select at least one division.</p>
        )}

        <button
          onClick={handleSend}
          disabled={!canSend}
          className="w-full py-3 rounded-xl bg-brand text-brand-dark font-semibold text-sm hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {sending
            ? 'Sending…'
            : `Send to ${recipientCount} player${recipientCount !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  )
}
