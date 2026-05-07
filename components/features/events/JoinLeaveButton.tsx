'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Props = {
  eventId: string
  currentStatus: string | null
  isCaptain: boolean
}

export default function JoinLeaveButton({ eventId, currentStatus, isCaptain }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleJoin() {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error } = await supabase.rpc('join_event', { p_event_id: eventId })
    if (error) {
      setError(error.message || 'Failed to join. Please try again.')
      console.error('join_event error:', error)
    } else {
      router.refresh()
    }
    setLoading(false)
  }

  async function handleLeave() {
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/events/${eventId}/leave`, { method: 'POST' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Failed to leave. Please try again.')
    } else {
      router.refresh()
    }
    setLoading(false)
  }

  if (currentStatus === 'joined') {
    return (
      <div className="space-y-2">
        {isCaptain && (
          <p className="text-xs text-brand-muted">
            You&apos;re the captain. Leaving while others are joined requires reassigning first.
          </p>
        )}
        <button
          onClick={handleLeave}
          disabled={loading}
          className="w-full border border-red-200 text-red-600 bg-brand-surface rounded-xl py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-red-50 transition-colors"
        >
          {loading ? 'Leaving…' : 'Leave session'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    )
  }

  if (currentStatus === 'waitlist') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-brand-muted bg-brand-soft border border-brand-border rounded-xl px-3 py-2">
          You&apos;re on the waitlist. You&apos;ll be promoted automatically if a spot opens.
        </p>
        <button
          onClick={handleLeave}
          disabled={loading}
          className="w-full border border-brand-border bg-brand-surface text-brand-muted rounded-xl py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-brand-soft transition-colors"
        >
          {loading ? 'Leaving…' : 'Leave waitlist'}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleJoin}
        disabled={loading}
        className="w-full bg-brand text-brand-dark rounded-xl py-2.5 text-sm font-semibold hover:bg-brand-hover active:bg-brand-active disabled:opacity-50 transition-colors"
      >
        {loading ? 'Joining…' : 'Join session'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
