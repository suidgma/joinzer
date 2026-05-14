'use client'

import { useEffect } from 'react'

type Props = {
  open: boolean
  title: string
  body: string
  confirmLabel?: string
  loading?: boolean
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}

export default function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  loading = false,
  error,
  onConfirm,
  onClose,
}: Props) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full sm:max-w-sm bg-white rounded-2xl p-6 space-y-4">
        <h2 className="font-heading text-base font-bold text-brand-dark">{title}</h2>
        <p className="text-sm text-brand-muted">{body}</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
          <button
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-brand-border text-brand-dark text-sm font-semibold hover:border-brand-active transition-colors disabled:opacity-50"
          >
            Keep registration
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {loading ? 'Cancelling…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
