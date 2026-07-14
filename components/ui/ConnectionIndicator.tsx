'use client'

import { useConnectionStatus } from '@/lib/realtime/hooks'

// Subtle tab-wide realtime status. Stays out of the way when healthy (a small green dot,
// no text) and only speaks up when reconnecting or offline.
export default function ConnectionIndicator() {
  const status = useConnectionStatus()

  if (status === 'live' || status === 'connecting') {
    return (
      <span
        className="inline-flex h-2 w-2 rounded-full bg-emerald-500"
        title="Live — updates in real time"
        aria-label="Connected, updates live"
      />
    )
  }

  const label = status === 'offline' ? 'Offline' : 'Reconnecting…'
  const dot = status === 'offline' ? 'bg-brand-muted' : 'bg-amber-500 animate-pulse'
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-brand-muted" title={label} role="status">
      <span className={`inline-flex h-2 w-2 rounded-full ${dot}`} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  )
}
