'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  tournamentId: string
  divisionId: string
  regId: string
}

export default function CheckinButton({ tournamentId, divisionId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCheckIn() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ division_id: divisionId }),
      })
      if (!res.ok) {
        const json = await res.json()
        setError(json.error ?? 'Check-in failed')
        return
      }
      router.replace(`/tournaments/${tournamentId}/checkin?div=${divisionId}&done=1`)
    } catch {
      setError('Network error — try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleCheckIn}
        disabled={loading}
        className="w-full py-3 rounded-xl bg-brand text-brand-dark text-base font-bold hover:bg-brand-hover disabled:opacity-50 transition-colors"
      >
        {loading ? 'Checking in…' : 'Check Me In ✓'}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
