'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Live presence ("who's viewing") via Supabase Realtime Presence. Returns the number of
// distinct viewers currently on the topic. Keyed by a stable id (the user's id when signed
// in, so multiple tabs collapse to one; a random id for anon viewers). Uses the shared
// browser client (one socket), but manages its own channel — presence is stateful
// (track/untrack per viewer), which doesn't fit the fan-out ChannelManager model; this is
// the one deliberate exception, scoped to presence.
export function usePresence(
  topic: string | null,
  opts: { presenceKey?: string | null; meta?: Record<string, unknown> } = {},
): number {
  const [count, setCount] = useState(0)
  const presenceKey = opts.presenceKey ?? null

  useEffect(() => {
    if (!topic) return
    const client = createClient()
    const key = presenceKey || crypto.randomUUID()
    const channel = client.channel(`presence:${topic}`, { config: { presence: { key } } })

    channel.on('presence', { event: 'sync' }, () => {
      setCount(Object.keys(channel.presenceState()).length)
    })
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') channel.track(opts.meta ?? { at: Date.now() })
    })

    return () => {
      channel.untrack()
      client.removeChannel(channel)
    }
    // meta is intentionally not a dependency — re-tracking on every render would churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, presenceKey])

  return count
}
