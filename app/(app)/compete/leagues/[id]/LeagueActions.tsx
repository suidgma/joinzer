'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Props = {
  leagueId: string
  registrationStatus: string
  myReg: 'registered' | 'waitlist' | 'cancelled' | null
  mySubInterest: boolean
  isFull: boolean
}

export default function LeagueActions({ leagueId, registrationStatus, myReg, mySubInterest, isFull }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [subLoading, setSubLoading] = useState(false)
  const [localReg, setLocalReg] = useState(myReg)
  const [localSub, setLocalSub] = useState(mySubInterest)

  const canRegister = registrationStatus === 'open' || registrationStatus === 'waitlist_only'

  async function handleRegister() {
    setLoading(true)
    const res = await fetch('/api/league-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId }),
    })
    if (res.ok) {
      const { status } = await res.json()
      setLocalReg(status)
      router.refresh()
    }
    setLoading(false)
  }

  async function handleCancel() {
    setLoading(true)
    const res = await fetch('/api/league-cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId }),
    })
    if (res.ok) {
      setLocalReg('cancelled')
      router.refresh()
    }
    setLoading(false)
  }

  async function handleSubToggle() {
    setSubLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSubLoading(false); return }

    if (localSub) {
      await supabase.from('league_sub_interest').delete().eq('league_id', leagueId).eq('user_id', user.id)
      setLocalSub(false)
    } else {
      await supabase.from('league_sub_interest').insert({ league_id: leagueId, user_id: user.id })
      setLocalSub(true)
    }
    setSubLoading(false)
  }

  return (
    <div className="space-y-2">
      {/* Main registration CTA */}
      {localReg === 'registered' && (
        <div className="bg-brand/20 border border-brand rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-brand-dark">You&apos;re registered ✓</p>
            <p className="text-xs text-brand-muted">You&apos;re in for this league</p>
          </div>
          <button onClick={handleCancel} disabled={loading} className="text-xs text-red-500 font-medium underline">
            Cancel
          </button>
        </div>
      )}

      {localReg === 'waitlist' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-brand-dark">On waitlist</p>
            <p className="text-xs text-brand-muted">You&apos;ll be notified if a spot opens</p>
          </div>
          <button onClick={handleCancel} disabled={loading} className="text-xs text-red-500 font-medium underline">
            Remove
          </button>
        </div>
      )}

      {(localReg === null || localReg === 'cancelled') && canRegister && (
        <button
          onClick={handleRegister}
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
        >
          {loading ? 'Saving…' : isFull ? 'Join Waitlist' : 'Register'}
        </button>
      )}

      {(localReg === null || localReg === 'cancelled') && registrationStatus === 'closed' && (
        <p className="text-sm text-center text-brand-muted py-2">Registration is closed.</p>
      )}

      {(localReg === null || localReg === 'cancelled') && registrationStatus === 'upcoming' && (
        <p className="text-sm text-center text-brand-muted py-2">Registration not yet open.</p>
      )}

      {/* Sub interest toggle */}
      {(localReg === null || localReg === 'cancelled') && (
        <button
          onClick={handleSubToggle}
          disabled={subLoading}
          className={`w-full py-2 rounded-xl border text-sm font-medium transition-colors ${
            localSub
              ? 'bg-brand-soft border-brand text-brand-dark'
              : 'bg-brand-surface border-brand-border text-brand-muted hover:border-brand-active'
          }`}
        >
          {subLoading ? 'Saving…' : localSub ? 'Sub interest removed ✓ (tap to undo)' : 'I\'m interested in subbing'}
        </button>
      )}
    </div>
  )
}
