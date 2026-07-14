'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useRealtimeContext } from './RealtimeProvider'
import { chatTopic } from './topics'
import type { RealtimePgPayload } from './channelManager'

// Cross-app chat unread. Loads the user's chat sources (leagues + tournaments), compares
// each source's latest message to the per-entity localStorage last-read (the SAME key
// ChatPanel writes, `chat-read:<table>:<id>`), and subscribes per source for live updates.
// Exposes an unread count per nav surface so BottomNav/DesktopNav can show a dot. Cleared
// when ChatPanel marks a chat read (it dispatches a `chat:read` window event).

type Surface = 'leagues' | 'tournaments'
type Source = { table: string; entityId: string; surface: Surface; latest: string }

const ENTITY_FIELD: Record<string, string> = {
  league_messages: 'league_id',
  tournament_messages: 'tournament_id',
}
const TABLE_SURFACE: Record<string, Surface> = {
  league_messages: 'leagues',
  tournament_messages: 'tournaments',
}

const readKey = (table: string, id: string) => `chat-read:${table}:${id}`

const ChatUnreadContext = createContext<Record<Surface, number>>({ leagues: 0, tournaments: 0 })

export function ChatUnreadProvider({ currentUserId, children }: { currentUserId: string | null; children: React.ReactNode }) {
  const { subscribe } = useRealtimeContext()
  const [sources, setSources] = useState<Source[]>([])
  // Unread entity keys, `${table}:${entityId}`.
  const [unread, setUnread] = useState<Set<string>>(new Set())

  // Load sources + seed initial unread from localStorage last-read.
  useEffect(() => {
    if (!currentUserId) return
    let cancelled = false
    fetch('/api/chat/unread-sources')
      .then((r) => (r.ok ? r.json() : { sources: [] }))
      .then((data: { sources: Source[] }) => {
        if (cancelled) return
        const srcs = data.sources ?? []
        setSources(srcs)
        const initial = new Set<string>()
        for (const s of srcs) {
          let lastRead = ''
          try { lastRead = localStorage.getItem(readKey(s.table, s.entityId)) ?? '' } catch {}
          if (!lastRead || s.latest > lastRead) initial.add(`${s.table}:${s.entityId}`)
        }
        setUnread(initial)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [currentUserId])

  // Live: a new message from someone else marks that source unread. Shares ChatPanel's
  // channel (same chatTopic + event '*'), so no extra socket work when a chat is open.
  useEffect(() => {
    if (!sources.length || !currentUserId) return
    const unsubs = sources.map((s) =>
      subscribe(
        { topic: chatTopic(s.table, s.entityId), postgresChanges: [{ event: '*', table: s.table, filter: `${ENTITY_FIELD[s.table]}=eq.${s.entityId}` }] },
        (evt) => {
          if (evt.kind !== 'postgres_changes') return
          const p = evt.payload as RealtimePgPayload
          if (p.eventType !== 'INSERT' || p.new?.user_id === currentUserId) return
          setUnread((prev) => new Set(prev).add(`${s.table}:${s.entityId}`))
        },
      ),
    )
    return () => unsubs.forEach((u) => u())
  }, [sources, currentUserId, subscribe])

  // Clear when ChatPanel marks a chat read.
  useEffect(() => {
    const onRead = (e: Event) => {
      const detail = (e as CustomEvent).detail as { table: string; entityId: string } | undefined
      if (!detail) return
      setUnread((prev) => {
        const key = `${detail.table}:${detail.entityId}`
        if (!prev.has(key)) return prev
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
    window.addEventListener('chat:read', onRead)
    return () => window.removeEventListener('chat:read', onRead)
  }, [])

  const counts = useMemo(() => {
    const c: Record<Surface, number> = { leagues: 0, tournaments: 0 }
    for (const key of unread) {
      const table = key.split(':')[0]
      const surface = TABLE_SURFACE[table]
      if (surface) c[surface] += 1
    }
    return c
  }, [unread])

  return <ChatUnreadContext.Provider value={counts}>{children}</ChatUnreadContext.Provider>
}

export function useChatUnread(): Record<Surface, number> {
  return useContext(ChatUnreadContext)
}
