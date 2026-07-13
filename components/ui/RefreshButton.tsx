'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCw } from 'lucide-react'

// Manual refresh fallback — re-fetches the server data and reconciles in place
// (no full page reload, keeps scroll + client state). For when auto-refresh or
// realtime hasn't caught up and someone wants to force the latest.
export default function RefreshButton({ className, label = 'Refresh' }: { className?: string; label?: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [spun, setSpun] = useState(false)

  function refresh() {
    setSpun(true)
    startTransition(() => router.refresh())
    window.setTimeout(() => setSpun(false), 800)
  }

  return (
    <button
      type="button"
      onClick={refresh}
      disabled={pending}
      title="Not seeing the latest? Refresh"
      className={`inline-flex items-center gap-1.5 text-xs font-medium text-brand-muted hover:text-brand-dark transition-colors disabled:opacity-60 ${className ?? ''}`}
    >
      <RotateCw className={`w-3.5 h-3.5 ${pending || spun ? 'animate-spin' : ''}`} />
      {label}
    </button>
  )
}
