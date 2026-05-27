'use client'
import { useState } from 'react'
import { CheckCircle, AlertCircle, ExternalLink } from 'lucide-react'

export type Status = {
  connected: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
  requirementsCount: number
}

export default function PayoutsPanel({ status }: { status: Status }) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function startOnboarding() {
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/stripe/connect/onboard', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || !json.url) {
        setError(json.error ?? 'Could not start Stripe onboarding')
        return
      }
      window.location.href = json.url
    } catch {
      setError('Network error')
      setSubmitting(false)
    }
  }

  const fullySetUp = status.connected && status.chargesEnabled && status.payoutsEnabled

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-brand-border p-4 space-y-3">
        <div className="flex items-start gap-3">
          {fullySetUp ? (
            <CheckCircle size={20} className="text-green-500 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle size={20} className="text-yellow-500 shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-brand-dark">
              {fullySetUp
                ? 'Stripe connected — you can accept payments'
                : status.connected
                  ? 'Stripe connected — finish setup to accept payments'
                  : 'Not connected'}
            </p>
            <p className="text-xs text-brand-muted mt-1">
              {fullySetUp
                ? 'Registration payments deposit to your bank account automatically.'
                : status.connected
                  ? `${status.requirementsCount} item${status.requirementsCount === 1 ? '' : 's'} still required by Stripe.`
                  : 'Players who register will not be charged until you connect.'}
            </p>
          </div>
        </div>

        <ul className="text-xs text-brand-muted space-y-1.5 pl-7">
          <li className="flex items-center gap-2">
            <StatusDot ok={status.connected} />
            Stripe account created
          </li>
          <li className="flex items-center gap-2">
            <StatusDot ok={status.chargesEnabled} />
            Can accept charges
          </li>
          <li className="flex items-center gap-2">
            <StatusDot ok={status.payoutsEnabled} />
            Can receive payouts
          </li>
        </ul>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          onClick={startOnboarding}
          disabled={submitting}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-brand text-brand-dark font-semibold text-sm hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting
            ? 'Opening Stripe…'
            : fullySetUp
              ? <>Manage Stripe account <ExternalLink size={14} /></>
              : status.connected
                ? <>Finish Stripe setup <ExternalLink size={14} /></>
                : <>Connect Stripe <ExternalLink size={14} /></>}
        </button>
      </div>

      <p className="text-xs text-brand-muted">
        Joinzer takes a small platform fee per paid registration. Refunds and tax handling stay between you and your players.
      </p>
    </div>
  )
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-green-500' : 'bg-gray-300'}`}
    />
  )
}
