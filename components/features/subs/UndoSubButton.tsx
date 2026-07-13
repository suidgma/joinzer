'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Undo2 } from 'lucide-react'

// Shown to a player who subbed themselves out, before the session starts, while the
// swap is still intact. Reverses it: removes the sub and puts the player back in.
export default function UndoSubButton({
  nominationId,
  nomineeName,
}: {
  nominationId: string
  nomineeName: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function undo() {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/sub-nominations/${nominationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'undo' }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok) router.refresh()
    else setError(json.error ?? 'Could not undo')
  }

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-brand-dark">
          <span className="font-semibold">{nomineeName}</span> is subbing in for you.
        </p>
        <p className="text-xs text-brand-muted">Changed your mind? Take your spot back.</p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      <button
        onClick={undo}
        disabled={busy}
        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-active hover:underline shrink-0 disabled:opacity-50"
      >
        <Undo2 className="w-3.5 h-3.5" /> {busy ? 'Undoing…' : 'Undo'}
      </button>
    </div>
  )
}
