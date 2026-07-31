'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useRealtimeContext } from './RealtimeProvider'
import { chatTopic } from './topics'
import { chatReadKey, computeInitialUnread } from '@/lib/chat/unread'
import { markChatRead, type ChatReadTable } from '@/lib/chat/readState'
import type { RealtimePgPayload } from './channelManager'

// Cross-app chat unread. Loads the user's chat sources (leagues + tournaments), compares
// each source's latest message to that user's DURABLE last-read from `chat_reads` (returned
// by the same endpoint), and subscribes per source for live updates. Exposes an unread count
// per nav surface so BottomNav/DesktopNav can show a dot. Cleared when ChatPanel marks a chat
// read (it dispatches a `chat:read` window event).
//
// localStorage (the same `chat-read:<table>:<id>` key ChatPanel writes) is an optimistic
// overlay only — it can move last-read forward, never backward, and it is never the source of
// truth. It used to be the ONLY store, and a missing key counted as unread, so clearing the
// browser cache lit up every league and tournament that had ever had a message.

type Surface = 'leagues' | 'tournaments'
type Source = { table: string; entityId: string; surface: Surface; latest: string; lastReadAt: string | null }

const ENTITY_FIELD: Record<string, string> = {
  league_messages: 'league_id',
  tournament_messages: 'tournament_id',
}
const TABLE_SURFACE: Record<string, Surface> = {
  league_messages: 'leagues',
  tournament_messages: 'tournaments',
}

// Both the rolled-up per-surface counts (for the nav dot) and the raw per-entity unread keys
// (`${table}:${entityId}`) so a list can show which specific league/tournament has unread chat.
type ChatUnreadValue = { counts: Record<Surface, number>; keys: Set<string> }
const ChatUnreadContext = createContext<ChatUnreadValue>({ counts: { leagues: 0, tournaments: 0 }, keys: new Set() })

export function ChatUnreadProvider({ currentUserId, children }: { currentUserId: string | null; children: React.ReactNode }) {
  const { subscribe } = useRealtimeContext()
  const [sources, setSources] = useState<Source[]>([])
  // Unread entity keys, `${table}:${entityId}`.
  const [unread, setUnread] = useState<Set<string>>(new Set())

  // Load sources + seed initial unread from the server's read state, with localStorage as an
  // optimistic overlay.
  useEffect(() => {
    if (!currentUserId) return
    let cancelled = false
    fetch('/api/chat/unread-sources')
      .then((r) => (r.ok ? r.json() : { sources: [] }))
      .then((data: { sources: Source[] }) => {
        if (cancelled) return
        const srcs = data.sources ?? []
        setSources(srcs)

        const localReads: Record<string, string> = {}
        for (const s of srcs) {
          const key = chatReadKey(s.table, s.entityId)
          try {
            const v = localStorage.getItem(key)
            if (v) localReads[key] = v
          } catch {}
        }

        const { unreadKeys, toPromote } = computeInitialUnread(srcs, localReads)
        setUnread(new Set(unreadKeys))

        // One-time backfill: this device read these chats before read state was durable, so
        // carry its keys up to the server. Self-converging — once promoted, the server is
        // ahead and this produces nothing on later loads, so it needs no version flag.
        for (const p of toPromote) {
          void markChatRead(p.table as ChatReadTable, p.entityId, p.lastReadAt)
        }
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

  const value = useMemo<ChatUnreadValue>(() => {
    const c: Record<Surface, number> = { leagues: 0, tournaments: 0 }
    for (const key of unread) {
      const table = key.split(':')[0]
      const surface = TABLE_SURFACE[table]
      if (surface) c[surface] += 1
    }
    return { counts: c, keys: unread }
  }, [unread])

  return <ChatUnreadContext.Provider value={value}>{children}</ChatUnreadContext.Provider>
}

// Per-surface rolled-up counts (nav dot).
export function useChatUnread(): Record<Surface, number> {
  return useContext(ChatUnreadContext).counts
}

// Raw per-entity unread keys (`${table}:${entityId}`) — for checking a specific chat inside a
// list without calling a hook per row.
export function useChatUnreadKeys(): Set<string> {
  return useContext(ChatUnreadContext).keys
}
