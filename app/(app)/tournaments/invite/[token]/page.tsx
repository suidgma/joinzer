'use client'

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type InviteDetails = {
  id: string
  status: string
  invitee_email: string
  inviter_name: string
  team_name: string | null
  tournament: { id: string; name: string; start_date: string }
  division: { id: string; name: string; category: string }
}

export default function InviteAcceptPage(props: { params: Promise<{ token: string }> }) {
  const params = use(props.params);
  const router = useRouter()
  const [invite, setInvite] = useState<InviteDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<'accepted' | 'declined' | null>(null)
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string } | null>(null)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) setCurrentUser({ id: user.id, email: user.email ?? '' })

      const res = await fetch(`/api/tournaments/invite/${params.token}`)
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Invitation not found'); setLoading(false); return }
      setInvite(json.invitation)
      setLoading(false)
    }
    load()
  }, [params.token])

  async function handleAction(action: 'accept' | 'decline') {
    if (!currentUser) {
      // Redirect to login, come back after
      router.push(`/login?redirect=/tournaments/invite/${params.token}`)
      return
    }
    setActing(true)
    setError(null)
    const res = await fetch(`/api/tournaments/invite/${params.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? 'Something went wrong'); setActing(false); return }
    setDone(action === 'accept' ? 'accepted' : 'declined')
    if (action === 'accept' && invite?.tournament?.id) {
      setTimeout(() => router.push(`/tournaments/${invite.tournament.id}`), 2000)
    }
    setActing(false)
  }

  if (loading) {
    return (
      <main className="max-w-sm mx-auto p-6 pt-16 text-center">
        <p className="text-sm text-brand-muted">Loading invitation…</p>
      </main>
    )
  }

  if (error && !invite) {
    return (
      <main className="max-w-sm mx-auto p-6 pt-16 text-center space-y-3">
        <p className="text-2xl">😕</p>
        <p className="font-heading text-base font-bold text-brand-dark">Invitation not found</p>
        <p className="text-sm text-brand-muted">{error}</p>
      </main>
    )
  }

  if (!invite) return null

  if (invite.status !== 'pending') {
    return (
      <main className="max-w-sm mx-auto p-6 pt-16 text-center space-y-3">
        <p className="text-2xl">{invite.status === 'accepted' ? '✅' : '❌'}</p>
        <p className="font-heading text-base font-bold text-brand-dark">
          Invitation already {invite.status}
        </p>
        <button onClick={() => router.push(`/tournaments/${invite.tournament.id}`)} className="text-sm text-brand-active underline">
          View tournament
        </button>
      </main>
    )
  }

  if (done) {
    return (
      <main className="max-w-sm mx-auto p-6 pt-16 text-center space-y-3">
        <p className="text-3xl">{done === 'accepted' ? '🎉' : '👋'}</p>
        <p className="font-heading text-base font-bold text-brand-dark">
          {done === 'accepted' ? 'You\'re registered!' : 'Invitation declined'}
        </p>
        <p className="text-sm text-brand-muted">
          {done === 'accepted'
            ? `Redirecting to the tournament…`
            : 'No worries — the organizer has been notified.'}
        </p>
        {done === 'declined' && (
          <button onClick={() => router.push('/tournaments')} className="text-sm text-brand-active underline">
            Browse tournaments
          </button>
        )}
      </main>
    )
  }

  return (
    <main className="max-w-sm mx-auto p-4 pt-10 space-y-5">
      <div className="text-center space-y-1">
        <p className="text-3xl">🏓</p>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Partner Invitation</h1>
        <p className="text-sm text-brand-muted">
          <strong className="text-brand-dark">{invite.inviter_name}</strong> wants you as their doubles partner
        </p>
      </div>

      <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
        <p className="font-heading text-sm font-bold text-brand-dark">{invite.tournament.name}</p>
        <p className="text-xs text-brand-muted">{invite.division.name}</p>
        {invite.team_name && (
          <p className="text-xs text-brand-muted">Team: <span className="text-brand-dark font-medium">{invite.team_name}</span></p>
        )}
      </div>

      {!currentUser && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 text-xs text-yellow-800">
          You need to sign in to accept this invitation. Your spot will be reserved.
        </div>
      )}

      {currentUser && currentUser.email && (
        <p className="text-xs text-center text-brand-muted">
          Accepting as <span className="font-medium text-brand-dark">{currentUser.email}</span>
        </p>
      )}

      {error && <p className="text-sm text-red-600 text-center">{error}</p>}

      <div className="flex flex-col gap-2">
        <button
          onClick={() => handleAction('accept')}
          disabled={acting}
          className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
        >
          {acting ? 'Processing…' : currentUser ? 'Accept & Register' : 'Sign in to Accept'}
        </button>
        <button
          onClick={() => handleAction('decline')}
          disabled={acting}
          className="w-full py-2.5 rounded-xl border border-brand-border text-sm text-brand-muted hover:bg-brand-soft disabled:opacity-50 transition-colors"
        >
          Decline
        </button>
      </div>
    </main>
  )
}
