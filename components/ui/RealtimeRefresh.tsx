'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useRealtimeChannel } from '@/lib/realtime/hooks'
import type { ChannelStatus, PgChangeConfig } from '@/lib/realtime/channelManager'

// Realtime-triggered server refresh. Subscribes to a broadcast topic and calls
// router.refresh() when an event arrives — an RSC refetch that reconciles in place
// (preserves scroll + client state), replacing manual Refresh buttons / interval polling.
// Used for deny-all data (league fixtures/standings) where fine-grained client patching
// isn't practical: the page just re-derives from fresh authorized server data.
//
// Robustness: bursts are debounced into one refresh; while the tab is hidden the refresh is
// deferred until it's visible again; and on a realtime reconnect (error → subscribed) it
// refreshes once to reconcile any broadcast missed while the socket was down (broadcast is
// ephemeral, so a disconnect otherwise loses those updates).
export default function RealtimeRefresh({ topic, events = [], private: isPrivate, postgresChanges }: { topic: string; events?: string[]; private?: boolean; postgresChanges?: PgChangeConfig[] }) {
  const router = useRouter()
  const pending = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevStatus = useRef<ChannelStatus>('connecting')

  const scheduleRefresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        pending.current = true
        return
      }
      router.refresh()
    }, 400)
  }, [router])

  useRealtimeChannel({ topic, broadcast: events, private: isPrivate, postgresChanges }, (evt) => {
    if (evt.kind === 'status') {
      if (prevStatus.current === 'error' && evt.status === 'subscribed') scheduleRefresh()
      prevStatus.current = evt.status
      return
    }
    // Either delivery mechanism (a broadcast signal, or a postgres_changes row event on a
    // public-readable table) triggers the same debounced RSC refresh.
    if (evt.kind === 'broadcast' || evt.kind === 'postgres_changes') scheduleRefresh()
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
