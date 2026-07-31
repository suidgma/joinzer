'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeChannel } from '@/lib/realtime/hooks'
import { chatTopic } from '@/lib/realtime/topics'
import { markChatRead } from '@/lib/chat/readState'
import { chatReadKey, selectDurableLastRead } from '@/lib/chat/unread'
import { formatChatTimestamp, formatTimestamp } from '@/lib/utils/date'

type Message = {
  id: string
  user_id: string
  message_text: string
  created_at: string
  profile: { name: string } | null
}

type Props = {
  table: 'league_messages' | 'tournament_messages'
  entityId: string
  entityField: string
  initialMessages: Message[]
  currentUserId: string | null
  canChat: boolean
  fullscreen?: boolean
}

export default function GroupChat({
  table,
  entityId,
  entityField,
  initialMessages,
  currentUserId,
  canChat,
  fullscreen = false,
}: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Pin the chat to its latest message by scrolling the chat's OWN container —
  // never the window. (scrollIntoView scrolls every ancestor, which dragged the
  // whole page down to the chat when a tournament/league page first opened.)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Read state. This component is rendered by a page whose entire content IS the chat, so
  // having it open is itself the engagement signal — there is no expand toggle, no visibility
  // observer, no unread badge and no "N new" pill here the way ChatPanel has them, and the
  // composer has no focus handler. Mount plus each new message therefore covers every way this
  // surface actually gets read; ChatPanel's five triggers have no equivalent to port.
  //
  // (ChatPanel deliberately does NOT mark read on mount, because it sits inside a longer page
  // where the chat can be far below the fold. Navigating to a dedicated chat page is not the
  // same act, so that reasoning doesn't carry over.)
  const readKey = chatReadKey(table, entityId)
  // Ids of sent-but-not-yet-confirmed rows, whose created_at is this device's clock.
  const optimisticIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!currentUserId || messages.length === 0) return

    // Gated on the tab actually being visible. This effect re-runs on every new message, so a
    // chat left open in a BACKGROUND tab would otherwise mark a whole conversation read and
    // suppress this league's nav dot for messages nobody ever saw. There is no local unread UI
    // here, so that dot is the only signal a reader would get.
    const markIfVisible = () => {
      if (document.visibilityState !== 'visible') return
      // Never persist an optimistic row's client clock — see selectDurableLastRead.
      const durable = selectDurableLastRead(messages, optimisticIdsRef.current)
      if (durable) {
        try { localStorage.setItem(readKey, durable) } catch {}
        markChatRead(table, entityId, durable).catch(() => {})
      }
      // Clear this league's nav/list dot via the cross-app unread provider.
      try { window.dispatchEvent(new CustomEvent('chat:read', { detail: { table, entityId } })) } catch {}
    }

    markIfVisible()
    // Opening this page in a background tab is a normal flow, and the mount above would be
    // skipped for it — so mark when the tab is actually brought to the front.
    document.addEventListener('visibilitychange', markIfVisible)
    return () => document.removeEventListener('visibilitychange', markIfVisible)
  }, [messages, readKey, table, entityId, currentUserId])

  useRealtimeChannel(
    currentUserId ? { topic: chatTopic(table, entityId), postgresChanges: [{ event: '*', table, filter: `${entityField}=eq.${entityId}` }] } : null,
    async (evt) => {
      if (evt.kind !== 'postgres_changes' || evt.payload.eventType !== 'INSERT') return
      const row = evt.payload.new as { id: string; user_id: string; message_text: string; created_at: string }
      // Skip messages we sent ourselves — already added optimistically.
      if (row.user_id === currentUserId) return
      const supabase = createClient()
      const { data: profile } = await supabase.from('profiles').select('name').eq('id', row.user_id).single()
      setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, { ...row, profile: profile ?? null }]))
    },
  )

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || sending || !currentUserId) return

    setSending(true)
    setSendError(null)
    setText('')

    const optimisticId = crypto.randomUUID()
    const optimistic: Message = {
      id: optimisticId,
      user_id: currentUserId,
      message_text: trimmed,
      created_at: new Date().toISOString(),
      profile: null,
    }
    optimisticIdsRef.current.add(optimisticId)
    setMessages((prev) => [...prev, optimistic])

    const supabase = createClient()
    // created_at comes back so the durable read state uses the DATABASE clock rather than this
    // device's — `optimistic.created_at` is only a placeholder for the in-flight moment. It
    // matters more here than in ChatPanel: this component skips its own realtime echo, so
    // without this the placeholder would never be replaced for the rest of the session.
    const { data: inserted, error } = await supabase.from(table).insert({
      [entityField]: entityId,
      user_id: currentUserId,
      message_text: trimmed,
    }).select('created_at').single()

    optimisticIdsRef.current.delete(optimisticId)

    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
      setSendError('Failed to send. Try again.')
      setText(trimmed)
    } else if (inserted?.created_at) {
      // Patching the row re-runs the read-state effect above, which now finds a
      // server-timestamped newest message and records the send durably.
      const serverCreatedAt = inserted.created_at
      setMessages((prev) => prev.map((m) => (m.id === optimisticId ? { ...m, created_at: serverCreatedAt } : m)))
    }

    setSending(false)
  }

  const inputArea = () => {
    if (!currentUserId) {
      return (
        <p className="text-xs text-gray-400 text-center py-2 border-t">
          Sign in to chat
        </p>
      )
    }
    if (!canChat) {
      return (
        <p className="text-xs text-gray-400 text-center py-2 border-t">
          Join to chat
        </p>
      )
    }
    return (
      <form onSubmit={handleSend} className="border-t border-brand-border bg-white">
        {sendError && (
          <p className="text-xs text-red-500 px-3 pt-2">{sendError}</p>
        )}
        <div className="flex gap-2 p-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message…"
            className="flex-1 text-sm px-3 py-1.5 border border-brand-border rounded-full focus:outline-none focus:ring-2 focus:ring-brand bg-brand-surface"
          />
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="bg-brand text-brand-dark text-sm px-4 py-1.5 rounded-full font-semibold disabled:opacity-40 hover:bg-brand-hover transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className={fullscreen ? 'flex flex-col h-full' : 'border border-brand-border rounded-2xl overflow-hidden'}>
      <div ref={scrollRef} className={`overflow-y-auto p-3 space-y-2 bg-brand-surface ${fullscreen ? 'flex-1 min-h-0' : 'h-80'}`}>
        {messages.length === 0 ? (
          <p className="text-xs text-brand-muted text-center pt-10">
            No messages yet — start the conversation
          </p>
        ) : (
          messages.map((msg) => {
            const isOwn = msg.user_id === currentUserId
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}
              >
                {!isOwn && (
                  <span className="text-xs text-brand-muted mb-0.5">
                    {msg.profile?.name ?? 'Unknown'}
                  </span>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm break-words ${
                    isOwn
                      ? 'bg-brand text-brand-dark rounded-br-sm'
                      : 'bg-white border border-brand-border rounded-bl-sm'
                  }`}
                >
                  {msg.message_text}
                </div>
                <time
                  dateTime={msg.created_at}
                  title={formatTimestamp(msg.created_at)}
                  className="text-[10px] text-brand-muted/70 mt-0.5 px-1 leading-none"
                  // Label depends on "now", so SSR across midnight can differ from hydration.
                  suppressHydrationWarning
                >
                  {formatChatTimestamp(msg.created_at)}
                </time>
              </div>
            )
          })
        )}
      </div>
      {inputArea()}
    </div>
  )
}
