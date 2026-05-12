'use client'
import { useState } from 'react'
import { X } from 'lucide-react'

type Props = {
  playerCount: number
  onClose: () => void
  onSent: () => void
}

export default function AnnounceModal({ playerCount, onClose, onSent }: Props) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSend() {
    // Player notifications not yet implemented — button is disabled in UI
  }

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
          <h2 className="font-heading text-base font-bold text-brand-dark">Announce to players</h2>
          <button onClick={onClose} className="p-1 text-brand-muted hover:text-brand-dark">
            <X size={18} />
          </button>
        </div>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Type your message to all players…"
          rows={4}
          className="input resize-none"
          autoFocus
        />
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Player notifications are not yet available. This feature is coming soon.
        </p>
        <button
          disabled
          className="w-full py-3 rounded-xl border border-brand-border text-brand-muted font-semibold text-sm opacity-60 cursor-not-allowed"
        >
          Send to {playerCount} player{playerCount !== 1 ? 's' : ''} — coming soon
        </button>
      </div>
    </div>
  )
}
