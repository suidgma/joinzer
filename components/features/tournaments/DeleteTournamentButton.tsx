'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DeleteTournamentButton({ tournamentId }: { tournamentId: string }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirm('Delete this tournament? This cannot be undone.')) return
    setDeleting(true)
    const res = await fetch(`/api/tournaments/${tournamentId}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json()
      alert(d.error ?? 'Failed to delete tournament')
      setDeleting(false)
      return
    }
    router.refresh()
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="text-xs text-red-500 underline underline-offset-2 hover:text-red-700 disabled:opacity-40"
    >
      {deleting ? 'Deleting…' : 'Delete'}
    </button>
  )
}
