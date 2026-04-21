'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Participant = {
  user_id: string
  profile: { name: string } | null
}

type Props = {
  eventId: string
  joinedParticipants: Participant[]
  currentUserId: string
}

export default function AssignCaptainButton({
  eventId,
  joinedParticipants,
  currentUserId,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const candidates = joinedParticipants.filter(
    (p) => p.user_id !== currentUserId
  )

  if (candidates.length === 0) return null

  async function handleAssign(newCaptainId: string) {
    setLoading(newCaptainId)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.rpc('assign_captain', {
      p_event_id: eventId,
      p_new_captain_id: newCaptainId,
    })
    if (error) {
      setError(error.message)
      setLoading(null)
    } else {
      router.refresh()
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-sm text-gray-500 underline underline-offset-2"
      >
        {open ? 'Cancel' : 'Reassign captain'}
      </button>

      {open && (
        <ul className="border rounded-lg divide-y">
          {candidates.map((p) => (
            <li
              key={p.user_id}
              className="flex items-center justify-between px-3 py-2"
            >
              <span className="text-sm">{p.profile?.name ?? 'Unknown'}</span>
              <button
                onClick={() => handleAssign(p.user_id)}
                disabled={loading === p.user_id}
                className="text-xs bg-black text-white px-3 py-1 rounded-full disabled:opacity-50"
              >
                {loading === p.user_id ? 'Assigning…' : 'Make captain'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
