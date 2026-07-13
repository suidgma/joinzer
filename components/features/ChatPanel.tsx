'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Maximize2, X } from 'lucide-react'

type Message = {
  id: string
  user_id: string
  message_text: string
  created_at: string
  profile: { name: string } | null
}

type ChatTable = 'event_messages' | 'league_messages' | 'tournament_messages'

type Props = {
  table: ChatTable
  entityField: string // 'event_id' | 'league_id' | 'tournament_id'
  entityId: string
  initialMessages: Message[]
  currentUserId: string | null
  canChat: boolean
  title?: string
  // Shown in place of the composer when the viewer can't post yet, e.g. "Join to chat".
  joinHint?: string
}

// Standard chat panel shared across Play, Leagues, and Tournaments. Shows a compact
// ~10-line inline preview with a live composer, and expands in place to a full-screen
// view ("Open") without navigating away — the same instance is reused, so scroll
// position, realtime subscription, and unsent text all survive the toggle.
export default function ChatPanel({
  table,
  entityField,
  entityId,
  initialMessages,
  currentUserId,
  canChat,
  title = 'Chat',
  joinHint = 'Join to chat',
}: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Pin to the latest message by scrolling the chat's OWN container, never the
  // window (scrollIntoView drags every ancestor and yanks the whole page down).
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, expanded])

  // While the full-screen view is open, lock body scroll and let Esc close it.
  useEffect(() => {
    if (!expanded) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [expanded])

  useEffect(() => {
    if (!currentUserId) return

    const supabase = createClient()
    const channel = supabase
      .channel(`${table}-${entityId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table,
          filter: `${entityField}=eq.${entityId}`,
        },
        async (payload) => {
          const row = payload.new as {
            id: string
            user_id: string
            message_text: string
            created_at: string
          }
          // Skip our own messages — already added optimistically on send.
          if (row.user_id === currentUserId) return
          const { data: profile } = await supabase
            .from('profiles')
            .select('name')
            .eq('id', row.user_id)
            .single()
          setMessages((prev) =>
            prev.some((m) => m.id === row.id)
              ? prev
              : [...prev, { ...row, profile: profile ?? null }]
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, entityId, entityField, currentUserId])

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
    setMessages((prev) => [...prev, optimistic])

    const supabase = createClient()
    const { error } = await supabase.from(table).insert({
      [entityField]: entityId,
      user_id: currentUserId,
      message_text: trimmed,
    })

    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
      setSendError('Failed to send. Try again.')
      setText(trimmed)
    }

    setSending(false)
  }

  const composer = () => {
    if (!currentUserId) {
      return (
        <p className="text-xs text-brand-muted text-center py-2.5 border-t border-brand-border">
          Sign in to chat
        </p>
      )
    }
    if (!canChat) {
      return (
        <p className="text-xs text-brand-muted text-center py-2.5 border-t border-brand-border">
          {joinHint}
        </p>
      )
    }
    return (
      <form onSubmit={handleSend} className="border-t border-brand-border bg-white">
        {sendError && <p className="text-xs text-red-500 px-3 pt-2">{sendError}</p>}
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
    <div className={expanded ? 'fixed inset-0 z-50 bg-brand-page' : ''}>
      <div
        className={
          expanded
            ? 'max-w-2xl mx-auto h-full flex flex-col'
            : 'border border-brand-border rounded-2xl overflow-hidden bg-white'
        }
      >
        {/* Header — title, message count, and the Open / Close toggle */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-brand-border bg-white shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm font-semibold text-brand-dark">{title}</h2>
            {messages.length > 0 && (
              <span className="text-[10px] font-bold bg-brand text-brand-dark px-1.5 py-0.5 rounded-full leading-none">
                {messages.length}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-muted hover:text-brand-dark transition-colors shrink-0"
            aria-label={expanded ? 'Close chat' : 'Open full chat'}
          >
            {expanded ? (
              <>
                <X className="w-4 h-4" /> Close
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" /> Open
              </>
            )}
          </button>
        </div>

        {/* Message list — ~10 lines inline, fills the screen when expanded */}
        <div
          ref={scrollRef}
          className={`overflow-y-auto p-3 space-y-2 bg-brand-surface ${
            expanded ? 'flex-1 min-h-0' : 'h-80'
          }`}
        >
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
                </div>
              )
            })
          )}
        </div>

        {composer()}
      </div>
    </div>
  )
}
