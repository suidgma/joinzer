'use client'

import { Eye } from 'lucide-react'
import { usePresence } from '@/lib/realtime/usePresence'

// Subtle live "who's watching" count for spectator surfaces (live scoreboard, public
// standings). Hidden when you're the only one here, so it only appears when it's true.
export default function ViewerCount({ topic, currentUserId }: { topic: string; currentUserId?: string | null }) {
  const count = usePresence(topic, { presenceKey: currentUserId ?? undefined })
  if (count < 2) return null
  return (
    <span className="inline-flex items-center gap-1 text-xs text-brand-muted" title="People viewing right now">
      <Eye className="w-3.5 h-3.5" />
      {count} watching
    </span>
  )
}
