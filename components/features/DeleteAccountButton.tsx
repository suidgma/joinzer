'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function DeleteAccountButton() {
  const router = useRouter()
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setLoading(true)
    setError(null)

    const res = await fetch('/api/delete-account', { method: 'POST' })
    if (!res.ok) {
      const body = await res.json()
      setError(body.error ?? 'Failed to delete account')
      setLoading(false)
      return
    }

    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/?deleted=1')
  }

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        className="w-full text-sm text-red-500 hover:text-red-600 font-medium py-2 transition-colors"
      >
        Delete account
      </button>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40" onClick={() => setShowConfirm(false)}>
          <div className="w-full max-w-sm bg-brand-surface rounded-2xl p-5 space-y-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-heading font-bold text-brand-dark">Delete your account?</h2>
            <p className="text-sm text-brand-muted">
              This will permanently delete your profile, remove you from all sessions, and cannot be undone.
            </p>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl border border-brand-border text-sm font-medium text-brand-muted hover:bg-brand-soft transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Deleting…' : 'Yes, delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
