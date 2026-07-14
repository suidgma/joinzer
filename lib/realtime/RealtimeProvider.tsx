'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ChannelManager, type ChannelSpec, type RealtimeEvent } from './channelManager'

// Aggregate, tab-wide connection state for the subtle live indicator.
export type ConnectionStatus = 'live' | 'connecting' | 'reconnecting' | 'offline'

type RealtimeContextValue = {
  subscribe: (spec: ChannelSpec, listener: (evt: RealtimeEvent) => void) => () => void
  connection: ConnectionStatus
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null)

// Mounted once, high in the authenticated app tree. Owns the single shared browser
// client + channel manager, and derives the global connection status from every live
// channel plus the browser's online/offline events.
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const managerRef = useRef<ChannelManager | null>(null)
  const recomputeRef = useRef<() => void>(() => {})
  const [connection, setConnection] = useState<ConnectionStatus>('connecting')

  if (!managerRef.current) {
    const client = createClient()
    // Authorize the realtime connection so private channels (per-user notifications) can
    // join. supabase-js also re-sets this on auth events; this eager call covers the initial
    // race before the first private subscription. Public channels are unaffected.
    client.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) client.realtime.setAuth(data.session.access_token)
    }).catch(() => {})
    managerRef.current = new ChannelManager(client, () => recomputeRef.current())
  }

  const recompute = useCallback(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setConnection('offline')
      return
    }
    const statuses = managerRef.current!.statuses()
    if (statuses.length === 0) {
      setConnection('live') // nothing to sync — treat as healthy
      return
    }
    if (statuses.every((s) => s === 'subscribed')) setConnection('live')
    else if (statuses.some((s) => s === 'error')) setConnection('reconnecting')
    else setConnection('connecting')
  }, [])

  useEffect(() => {
    recomputeRef.current = recompute
    recompute()
    const online = () => recompute()
    const offline = () => setConnection('offline')
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [recompute])

  const subscribe = useCallback(
    (spec: ChannelSpec, listener: (evt: RealtimeEvent) => void) => managerRef.current!.subscribe(spec, listener),
    [],
  )

  const value = useMemo(() => ({ subscribe, connection }), [subscribe, connection])
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

export function useRealtimeContext(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext)
  if (!ctx) throw new Error('Realtime hooks must be used within <RealtimeProvider>')
  return ctx
}
