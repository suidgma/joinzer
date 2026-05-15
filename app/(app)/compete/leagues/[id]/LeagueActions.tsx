'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import ConfirmModal from '@/components/ui/ConfirmModal'
import SessionSubList from './SessionSubList'

const DOUBLES_FORMATS = ['mens_doubles', 'womens_doubles', 'mixed_doubles', 'coed_doubles']

type Session = {
  id: string
  session_number: number
  session_date: string
  status: string
}

type Props = {
  leagueId: string
  leagueName: string
  registrationStatus: string
  myReg: 'registered' | 'waitlist' | 'cancelled' | null
  mySubInterest: boolean
  isFull: boolean
  costCents: number
  format: string
  partnerUserName?: string | null
  sessions: Session[]
  mySubSessionIds: string[]
  waitlistPosition: number | null
  waitlistTotal: number
}

export default function LeagueActions({ leagueId, leagueName, registrationStatus, myReg, mySubInterest, isFull, costCents, format, partnerUserName, sessions, mySubSessionIds, waitlistPosition, waitlistTotal }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [subLoading, setSubLoading] = useState(false)
  const [localReg, setLocalReg] = useState(myReg)
  const [localSub, setLocalSub] = useState(mySubInterest)
  const [localPartner, setLocalPartner] = useState(partnerUserName ?? null)
  const [error, setError] = useState<string | null>(null)
  const [regType, setRegType] = useState<'team' | 'solo'>('team')
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const isDoubles = DOUBLES_FORMATS.includes(format)

  const canRegister = registrationStatus === 'open' || registrationStatus === 'waitlist_only'
  const isPaid = costCents > 0

  async function handleRegister() {
    setLoading(true)
    setError(null)

    if (isPaid) {
      // Paid league — go to Stripe checkout
      const res = await fetch(`/api/leagues/${leagueId}/checkout`, { method: 'POST' })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
        return
      }
      setError(data.error ?? 'Could not start checkout')
      setLoading(false)
      return
    }

    // Free league — register directly
    const res = await fetch('/api/league-register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId, registration_type: regType }),
    })
    if (res.ok) {
      const data = await res.json()
      setLocalReg(data.status)
      if (data.matchedWith?.name) setLocalPartner(data.matchedWith.name)
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Registration failed')
    }
    setLoading(false)
  }

  async function handleCancel() {
    setLoading(true)
    setCancelError(null)
    const res = await fetch('/api/league-cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagueId }),
    })
    if (res.ok) {
      setShowCancelConfirm(false)
      setLocalReg('cancelled')
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setCancelError(data.error === 'Already cancelled' ? 'Already cancelled — refreshing…' : (data.error ?? "Couldn't cancel — please try again"))
      if (data.error === 'Already cancelled') router.refresh()
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
            <p className="text-xs text-brand-muted">
              {localPartner
                ? `Partner: ${localPartner}`
                : isDoubles && !localPartner
                  ? 'Solo — awaiting partner match'
                  : "You're in for this league"}
            </p>
          </div>
          <button onClick={() => setShowCancelConfirm(true)} disabled={loading} className="text-xs text-red-500 font-medium underline">
            Cancel
          </button>
        </div>
      )}

      {localReg === 'waitlist' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-brand-dark">
              {waitlistPosition != null ? `Waitlist #${waitlistPosition} of ${waitlistTotal}` : 'On waitlist'}
            </p>
            <p className="text-xs text-brand-muted">You&apos;ll be notified if a spot opens</p>
          </div>
          <button onClick={() => setShowCancelConfirm(true)} disabled={loading} className="text-xs text-red-500 font-medium underline">
            Remove
          </button>
        </div>
      )}

      {(localReg === null || localReg === 'cancelled') && canRegister && (
        <div className="space-y-2">
          {isDoubles && (
            <div className="flex rounded-xl overflow-hidden border border-brand-border">
              <button
                type="button"
                onClick={() => setRegType('team')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${regType === 'team' ? 'bg-brand text-brand-dark' : 'bg-white text-brand-muted hover:bg-brand-soft'}`}
              >
                Team (with partner)
              </button>
              <button
                type="button"
                onClick={() => setRegType('solo')}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${regType === 'solo' ? 'bg-brand text-brand-dark' : 'bg-white text-brand-muted hover:bg-brand-soft'}`}
              >
                Individual (solo)
              </button>
            </div>
          )}
          {isDoubles && regType === 'solo' && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              You&apos;ll be automatically matched with another solo player. Both of you will be notified by email.
            </p>
          )}
          {isPaid && (
            <p className="text-xs text-brand-muted text-center">
              Registration fee: <span className="font-semibold text-brand-dark">${(costCents / 100).toFixed(0)}</span> — paid securely via Stripe
            </p>
          )}
          <button
            onClick={handleRegister}
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
          >
            {loading
              ? isPaid ? 'Redirecting to payment…' : 'Saving…'
              : isPaid
                ? isFull ? `Pay $${(costCents / 100).toFixed(0)} — Join Waitlist` : `Pay $${(costCents / 100).toFixed(0)} to Register`
                : isFull ? 'Join Waitlist' : regType === 'solo' ? 'Register as Individual' : 'Register'
            }
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {(localReg === null || localReg === 'cancelled') && registrationStatus === 'closed' && (
        <p className="text-sm text-center text-brand-muted py-2">Registration is closed.</p>
      )}

      {(localReg === null || localReg === 'cancelled') && registrationStatus === 'upcoming' && (
        <p className="text-sm text-center text-brand-muted py-2">Registration not yet open.</p>
      )}

      {/* Sub interest + per-session availability */}
      {(localReg === null || localReg === 'cancelled') && (
        localSub ? (
          <div className="space-y-2">
            <div className="bg-brand-soft border border-brand rounded-2xl px-4 py-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-brand-dark">On the sub list ✓</p>
              <button
                onClick={handleSubToggle}
                disabled={subLoading}
                className="text-xs text-brand-muted font-medium underline"
              >
                {subLoading ? '…' : 'Manage'}
              </button>
            </div>
            {sessions.length > 0 && (
              <SessionSubList sessions={sessions} mySubSessionIds={new Set(mySubSessionIds)} />
            )}
          </div>
        ) : (
          <button
            onClick={handleSubToggle}
            disabled={subLoading}
            className="w-full py-2 rounded-xl border border-brand-border bg-brand-surface text-sm font-medium text-brand-muted hover:border-brand-active transition-colors"
          >
            {subLoading ? 'Saving…' : "I'm interested in subbing"}
          </button>
        )
      )}
      <ConfirmModal
        open={showCancelConfirm}
        title="Cancel registration?"
        body={`Cancel your registration for ${leagueName}? This can't be undone, and your spot may be given to someone on the waitlist.`}
        confirmLabel="Cancel registration"
        loading={loading}
        error={cancelError}
        onConfirm={handleCancel}
        onClose={() => { setShowCancelConfirm(false); setCancelError(null) }}
      />
    </div>
  )
}
