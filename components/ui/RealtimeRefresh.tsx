'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useRealtimeChannel } from '@/lib/realtime/hooks'

// Realtime-triggered server refresh. Subscribes to a broadcast topic and calls
// router.refresh() when an event arrives — an RSC refetch that reconciles in place
// (preserves scroll + client state), replacing manual Refresh buttons / interval polling.
// Used for deny-all data (league fixtures/standings) where fine-grained client patching
// isn't practical: the page just re-derives from fresh authorized server data.
//
// Bursts are debounced into one refresh; while the tab is hidden the refresh is deferred
// until it's visible again (no wasted refetches in a backgrounded tab).
export default function RealtimeRefresh({ topic, events }: { topic: string; events: string[] }) {
  const router = useRouter()
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useRealtimeChannel({ topic, broadcast: events }, (evt) => {
    if (evt.kind !== 'broadcast') return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        pending.current = true
        return
      }
      router.refresh()
    }, 400)
  })

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && pending.current) {
        pending.current = false
        router.refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [router])

  return null
}
