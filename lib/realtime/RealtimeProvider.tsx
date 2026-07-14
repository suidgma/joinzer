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
    managerRef.current = new ChannelManager(createClient(), () => recomputeRef.current())
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

  // Authenticate the realtime socket. This is REQUIRED for any RLS-scoped postgres_changes
  // to deliver — membership-gated chat (auth.uid()) and the `authenticated`-only league score/
  // attendance tables all return nothing on an anon socket, so without this the live updates
  // silently stop and the page needs a manual refresh. setAuth re-authorizes channels that
  // already subscribed, so it doesn't matter that child components subscribe before this runs.
  // Kept fresh on sign-in / token-refresh / sign-out.
  useEffect(() => {
    const client = createClient()
    const apply = (token?: string) => { if (token) client.realtime.setAuth(token) }
    client.auth.getSession().then(({ data }) => apply(data.session?.access_token)).catch(() => {})
    const { data: sub } = client.auth.onAuthStateChange((_event, session) => apply(session?.access_token ?? undefined))
    return () => sub.subscription.unsubscribe()
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
