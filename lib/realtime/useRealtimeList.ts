'use client'

import { useRef, useState } from 'react'
import { useRealtimeChannel } from './hooks'
import type { ChannelStatus, RealtimePgPayload } from './channelManager'

// Workhorse hook: keep a server-seeded list in sync via postgres_changes, patching only
// the row that changed (INSERT appends, UPDATE replaces, DELETE removes) — never a full
// refetch. De-dupes by id, so an optimistic row inserted with a client-generated id is
// reconciled when its realtime echo arrives. On reconnect (error → subscribed) it runs
// an optional one-shot refetch to fill the gap of events missed while disconnected.
export function useRealtimeList<T extends { id: string }>({
  topic,
  table,
  filter,
  initial,
  mapRow,
  onReconcile,
}: {
  topic: string | null
  table: string
  filter?: string
  initial: T[]
  /** Hydrate a raw DB row into T (e.g. fetch the author's name). May be async. */
  mapRow: (row: Record<string, any>) => T | Promise<T>
  /** Optional full refetch used once after a reconnect to reconcile missed events. */
  onReconcile?: () => Promise<T[] | null>
}): { items: T[]; setItems: React.Dispatch<React.SetStateAction<T[]>>; status: ChannelStatus } {
  const [items, setItems] = useState<T[]>(initial)
  const prevStatus = useRef<ChannelStatus>('connecting')

  const status = useRealtimeChannel(
    topic ? { topic, postgresChanges: [{ event: '*', table, ...(filter ? { filter } : {}) }] } : null,
    async (evt) => {
      if (evt.kind === 'status') {
        if (prevStatus.current === 'error' && evt.status === 'subscribed' && onReconcile) {
          const fresh = await onReconcile()
          if (fresh) setItems(fresh)
        }
        prevStatus.current = evt.status
        return
      }
      if (evt.kind !== 'postgres_changes') return
      const p = evt.payload as RealtimePgPayload

      if (p.eventType === 'DELETE') {
        const id = p.old?.id
        if (id) setItems((prev) => prev.filter((x) => x.id !== id))
        return
      }
      if (p.eventType === 'INSERT') {
        const row = await mapRow(p.new)
        setItems((prev) => (prev.some((x) => x.id === row.id) ? prev : [...prev, row]))
        return
      }
      if (p.eventType === 'UPDATE') {
        const row = await mapRow(p.new)
        setItems((prev) => prev.map((x) => (x.id === row.id ? row : x)))
      }
    },
  )

  return { items, setItems, status }
}
