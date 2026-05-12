'use client'
import { useState, useEffect } from 'react'
import { ExternalLink } from 'lucide-react'
import Link from 'next/link'

type Status = { connected: boolean; chargesEnabled: boolean; accountId?: string } | null

export default function PayoutsPage() {
  const [status, setStatus] = useState<Status>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/stripe/connect/status')
      .then(r => r.json())
      .then(j => { setStatus(j); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function handleConnect() {
    setConnecting(true)
    setError(null)
    const res = await fetch('/api/stripe/connect/onboard', { method: 'POST' })
    const json = await res.json()
    if (!res.ok) { setError(json.error ?? 'Failed'); setConnecting(false); return }
    window.location.href = json.url
  }

  const dot = (active: boolean) => (
    <span className={`inline-block w-2.5 h-2.5 rounded-full ${active ? 'bg-green-500' : 'bg-gray-300'}`} />
  )

  return (
    <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/profile" className="text-sm text-brand-muted hover:text-brand-dark">← Profile</Link>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Payouts</h1>
      </div>

      <div className="bg-white border border-brand-border rounded-2xl p-6 space-y-5">
        <div>
          <h2 className="font-heading text-base font-bold text-brand-dark">Stripe Connect</h2>
          <p className="text-sm text-brand-muted mt-1">
            Connect a Stripe account to receive registration fees directly when you run a paid tournament.
          </p>
        </div>

        {loading && <p className="text-sm text-brand-muted">Loading…</p>}

        {!loading && status && (
          <div className="space-y-3">
            {/* Status indicators */}
            <div className="bg-brand-surface rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-brand-muted">Account linked</span>
                <div className="flex items-center gap-2">
                  {dot(status.connected)}
                  <span className={`font-semibold ${status.connected ? 'text-green-600' : 'text-gray-500'}`}>
                    {status.connected ? 'Connected' : 'Not connected'}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-brand-muted">Charges enabled</span>
                <div className="flex items-center gap-2">
                  {dot(status.chargesEnabled)}
                  <span className={`font-semibold ${status.chargesEnabled ? 'text-green-600' : 'text-gray-500'}`}>
                    {status.chargesEnabled ? 'Active' : 'Pending'}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-brand-muted">Payouts</span>
                <div className="flex items-center gap-2">
                  {dot(status.chargesEnabled)}
                  <span className={`font-semibold ${status.chargesEnabled ? 'text-green-600' : 'text-gray-500'}`}>
                    {status.chargesEnabled ? 'Enabled' : 'Pending'}
                  </span>
                </div>
              </div>
            </div>

            {!status.connected && (
              <>
                {error && <p className="text-xs text-red-600">{error}</p>}
                <button
                  onClick={handleConnect}
                  disabled={connecting}
                  className="w-full py-3 rounded-xl bg-brand-dark text-white text-sm font-semibold hover:bg-brand-dark/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  <ExternalLink size={15} />
                  {connecting ? 'Redirecting…' : 'Connect Stripe Account'}
                </button>
              </>
            )}

            {status.connected && !status.chargesEnabled && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
                <p className="text-sm font-medium text-yellow-800">Finish setting up your Stripe account</p>
                <p className="text-xs text-yellow-700 mt-1">
                  Stripe needs more info before payouts are enabled. Click below to complete onboarding.
                </p>
                <button
                  onClick={handleConnect}
                  disabled={connecting}
                  className="mt-2 text-xs font-semibold text-yellow-800 underline"
                >
                  {connecting ? 'Redirecting…' : 'Continue onboarding →'}
                </button>
              </div>
            )}

            {status.connected && status.chargesEnabled && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <p className="text-sm font-semibold text-green-700">✓ You&apos;re all set</p>
                <p className="text-xs text-green-600 mt-1">
                  Registration fees from your tournaments will be sent directly to your Stripe account.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-brand-muted text-center">
        Joinzer charges a 5% platform fee on each paid registration.{' '}
        <a href="https://stripe.com/connect" target="_blank" rel="noopener noreferrer" className="text-brand-active hover:underline">
          Learn about Stripe Connect →
        </a>
      </p>
    </main>
  )
}
