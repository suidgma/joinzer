'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Opens the next ladder session (king-of-the-court night). Shown on the run hub
// when no session is in progress.
export default function LadderStartButton({ leagueId, disabled }: { leagueId: string; disabled?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/ladder/start-session`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j.error ?? 'Failed to start session')
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={start}
        disabled={busy || disabled}
        className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
      >
        {busy ? 'Starting…' : 'Start session'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
