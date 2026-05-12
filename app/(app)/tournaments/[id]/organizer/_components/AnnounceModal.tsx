'use client'
import { useState } from 'react'
import { X } from 'lucide-react'

type Props = {
  tournamentId: string
  playerCount: number
  onClose: () => void
  onSent: () => void
}

export default function AnnounceModal({ tournamentId, playerCount, onClose, onSent }: Props) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSend() {
    if (!subject.trim() || !body.trim()) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/announce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
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

  const canSend = subject.trim().length > 0 && body.trim().length > 0 && !sending

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-end justify-center sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-4"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base font-bold text-brand-dark">Email players</h2>
          <button onClick={onClose} className="p-1 text-brand-muted hover:text-brand-dark">
            <X size={18} />
          </button>
        </div>

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
          placeholder="Your message to all registered players…"
          rows={4}
          className="input resize-none w-full"
        />

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          onClick={handleSend}
          disabled={!canSend}
          className="w-full py-3 rounded-xl bg-brand text-brand-dark font-semibold text-sm hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? 'Sending…' : `Send to ${playerCount} player${playerCount !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  )
}
