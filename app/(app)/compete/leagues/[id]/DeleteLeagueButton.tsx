'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DeleteLeagueButton({ leagueId }: { leagueId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/leagues/${leagueId}`, { method: 'DELETE' })
    if (res.ok) {
      router.push('/compete')
      router.refresh()
    } else {
      const body = await res.json()
      setError(body.error ?? 'Failed to delete league')
      setLoading(false)
      setConfirming(false)
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-sm text-red-600 underline underline-offset-2"
      >
        Delete league
      </button>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-red-700 font-medium">Delete this league? This cannot be undone.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-3">
        <button
          onClick={handleDelete}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Deleting…' : 'Yes, delete'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={loading}
          className="px-3 py-1.5 rounded-lg border border-brand-border text-sm text-brand-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
