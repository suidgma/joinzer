'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

const inputClass = 'w-full input'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <main className="min-h-screen bg-brand-page flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-3">
          <h1 className="font-heading text-xl font-bold text-brand-dark">Check your email</h1>
          <p className="text-sm text-brand-muted">
            We sent a password reset link to <strong className="text-brand-dark">{email}</strong>.
          </p>
          <Link href="/login" className="text-sm text-brand-active font-medium underline underline-offset-2">
            Back to sign in
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-brand-page flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Joinzer" className="w-12 h-12 object-contain mx-auto mb-3" />
          <h1 className="font-heading text-xl font-bold text-brand-dark">Reset your password</h1>
          <p className="text-sm text-brand-muted mt-1">
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>

        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-brand-dark mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputClass}
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand text-brand-dark rounded-xl py-2.5 text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>

          <div className="text-center">
            <Link href="/login" className="text-sm text-brand-muted hover:text-brand-dark underline underline-offset-2">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
