'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRealtimeList } from '@/lib/realtime/useRealtimeList'
import { chatTopic } from '@/lib/realtime/topics'
import { Maximize2, X, ArrowDown, Pencil, Trash2 } from 'lucide-react'

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
// view without navigating away. Realtime runs through the shared realtime infra
// (useRealtimeList): new messages append (dedup by id), edits/deletes patch in place,
// and a reconnect refetches the tail to fill any gap. Scroll position is preserved —
// if you're reading older messages a "new messages" pill appears instead of yanking you
// to the bottom.
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
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [newCount, setNewCount] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const prevLenRef = useRef(initialMessages.length)

  // Hydrate a raw message row into the display shape, fetching the author's name.
  const mapRow = useCallback(async (row: Record<string, any>): Promise<Message> => {
    const base: Message = {
      id: row.id,
      user_id: row.user_id,
      message_text: row.message_text,
      created_at: row.created_at,
      profile: null,
    }
    if (row.user_id === currentUserId) return base // own messages don't show a name
    const supabase = createClient()
    const { data: profile } = await supabase.from('profiles').select('name').eq('id', row.user_id).single()
    return { ...base, profile: profile ?? null }
  }, [currentUserId])

  // Reconnect reconciliation: refetch the recent tail + author names in one batch.
  const onReconcile = useCallback(async (): Promise<Message[] | null> => {
    const supabase = createClient()
    const { data: rows } = await supabase
      .from(table)
      .select('id, user_id, message_text, created_at')
      .eq(entityField, entityId)
      .order('created_at', { ascending: true })
      .limit(200)
    if (!rows) return null
    const userIds = [...new Set(rows.map((r) => r.user_id))]
    const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', userIds)
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.name]))
    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      message_text: r.message_text,
      created_at: r.created_at,
      profile: r.user_id === currentUserId ? null : { name: nameById.get(r.user_id) ?? 'Unknown' },
    }))
  }, [table, entityField, entityId, currentUserId])

  const { items: messages, setItems: setMessages, status } = useRealtimeList<Message>({
    topic: currentUserId ? chatTopic(table, entityId) : null,
    table,
    filter: `${entityField}=eq.${entityId}`,
    initial: initialMessages,
    mapRow,
    onReconcile,
  })

  // Persistent unread count: messages from others newer than the last time this viewer
  // engaged with the chat (localStorage, per entity). Cleared on expand / focus / send /
  // pill — deliberately NOT on the mount auto-scroll, so arriving on the page still shows
  // "N new" until you engage.
  const readKey = `chat-read:${table}:${entityId}`
  const [lastRead, setLastRead] = useState('')
  useEffect(() => {
    try { setLastRead(localStorage.getItem(readKey) ?? '') } catch {}
  }, [readKey])
  const unread = messages.reduce(
    (n, m) => (m.user_id !== currentUserId && (!lastRead || m.created_at > lastRead) ? n + 1 : n),
    0,
  )
  const markRead = useCallback(() => {
    const newest = messages.length ? messages[messages.length - 1].created_at : ''
    if (!newest) return
    setLastRead(newest)
    try { localStorage.setItem(readKey, newest) } catch {}
    // Let the cross-app unread provider clear this chat's nav/list dot.
    try { window.dispatchEvent(new CustomEvent('chat:read', { detail: { table, entityId } })) } catch {}
  }, [messages, readKey, table, entityId])

  // Seeing the chat (it scrolls into view) counts as reading it — clears the "N new" badge and the
  // cross-app unread dot even if the reader never clicks in. Previously read only fired on
  // expand/focus/send, so someone who just read the inline preview kept a dot forever. Gated on real
  // visibility so merely landing on a long page (chat far below the fold) doesn't pre-clear it.
  const panelRef = useRef<HTMLDivElement>(null)
  const markReadRef = useRef(markRead)
  useEffect(() => { markReadRef.current = markRead }, [markRead])
  useEffect(() => {
    const el = panelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) markReadRef.current() },
      { threshold: 0.5 },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    setNewCount(0)
  }, [])

  // Track whether the reader is pinned near the bottom (so incoming messages don't
  // yank them up while they're reading history).
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    atBottomRef.current = nearBottom
    if (nearBottom) setNewCount(0)
  }, [])

  // When the list grows: auto-scroll if the reader is at the bottom, otherwise surface a
  // "N new messages" pill. Shrinks/edits don't change scroll intent.
  useEffect(() => {
    const grew = messages.length - prevLenRef.current
    prevLenRef.current = messages.length
    if (atBottomRef.current) scrollToBottom()
    else if (grew > 0) setNewCount((n) => n + grew)
  }, [messages, scrollToBottom])

  // Keep pinned to the bottom when the view mode toggles (open/close). Opening the chat
  // counts as reading it (and stays read as new messages arrive while expanded).
  useEffect(() => {
    if (atBottomRef.current) scrollToBottom()
    if (expanded) markRead()
  }, [expanded, scrollToBottom, markRead])

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

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || sending || !currentUserId) return

    setSending(true)
    setSendError(null)
    setText('')

    // Insert with a client-generated id so the realtime echo de-dupes against this
    // optimistic row (no "skip own" needed, and edits/deletes reconcile uniformly).
    const optimisticId = crypto.randomUUID()
    const optimistic: Message = {
      id: optimisticId,
      user_id: currentUserId,
      message_text: trimmed,
      created_at: new Date().toISOString(),
      profile: null,
    }
    atBottomRef.current = true
    setMessages((prev) => [...prev, optimistic])
    markRead()

    const supabase = createClient()
    const { error } = await supabase.from(table).insert({
      id: optimisticId,
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

  // Edit own message — optimistic, revert on failure. The realtime UPDATE echo reconciles
  // every other viewer (useRealtimeList patches by id).
  async function saveEdit(msg: Message) {
    const trimmed = editText.trim()
    setEditingId(null)
    if (!trimmed || trimmed === msg.message_text) return
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, message_text: trimmed } : m)))
    const supabase = createClient()
    const { error } = await supabase.from(table).update({ message_text: trimmed }).eq('id', msg.id)
    if (error) setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, message_text: msg.message_text } : m)))
  }

  // Delete own message — optimistic, re-insert (sorted) on failure. Realtime DELETE removes it
  // for everyone else.
  async function deleteMsg(msg: Message) {
    setConfirmDeleteId(null)
    setMessages((prev) => prev.filter((m) => m.id !== msg.id))
    const supabase = createClient()
    const { error } = await supabase.from(table).delete().eq('id', msg.id)
    if (error) {
      setMessages((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      )
    }
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
            onFocus={markRead}
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
    <div ref={panelRef} className={expanded ? 'fixed inset-0 z-50 bg-brand-page' : ''}>
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
            {!expanded && unread > 0 ? (
              <span className="text-[10px] font-bold bg-brand-dark text-white px-1.5 py-0.5 rounded-full leading-none">
                {unread} new
              </span>
            ) : messages.length > 0 ? (
              <span className="text-[10px] font-bold bg-brand text-brand-dark px-1.5 py-0.5 rounded-full leading-none">
                {messages.length}
              </span>
            ) : null}
            {status === 'error' && (
              <span className="text-[10px] text-amber-600" title="Reconnecting…">• reconnecting</span>
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
        <div className="relative">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className={`overflow-y-auto overflow-x-hidden p-3 space-y-2 bg-brand-surface ${
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
                const isEditing = editingId === msg.id
                const isConfirming = confirmDeleteId === msg.id
                return (
                  <div key={msg.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                    {/* Column caps at 80% of the FULL-WIDTH row above (not a shrink-to-fit
                        parent), so bubbles never collapse to a couple chars or overflow. */}
                    <div className={`flex flex-col min-w-0 max-w-[80%] ${isOwn ? 'items-end' : 'items-start'}`}>
                      {!isOwn && (
                        <span className="text-xs text-brand-muted mb-0.5">
                          {msg.profile?.name ?? 'Unknown'}
                        </span>
                      )}
                      {isEditing ? (
                        <div className="flex items-center gap-1 w-full">
                          <input
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit(msg)
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                            autoFocus
                            className="flex-1 min-w-0 text-sm px-2.5 py-1.5 border border-brand-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand bg-white"
                          />
                          <button onClick={() => saveEdit(msg)} className="text-xs font-semibold text-brand-active px-1">Save</button>
                          <button onClick={() => setEditingId(null)} className="text-xs text-brand-muted px-1">Cancel</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 min-w-0 max-w-full">
                          {isOwn && !isConfirming && (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={() => { setEditingId(msg.id); setEditText(msg.message_text) }}
                                aria-label="Edit message"
                                className="text-brand-muted/60 hover:text-brand-dark transition-colors"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(msg.id)}
                                aria-label="Delete message"
                                className="text-brand-muted/60 hover:text-red-500 transition-colors"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                          {/* min-w-0 lets the bubble shrink; break-words wraps a long unbreakable word. */}
                          <div
                            className={`min-w-0 rounded-2xl px-3 py-2 text-sm break-words ${
                              isOwn
                                ? 'bg-brand text-brand-dark rounded-br-sm'
                                : 'bg-white border border-brand-border rounded-bl-sm'
                            }`}
                          >
                            {msg.message_text}
                          </div>
                        </div>
                      )}
                      {isConfirming && (
                        <div className="flex items-center gap-2 mt-1 text-xs">
                          <span className="text-brand-muted">Delete this message?</span>
                          <button onClick={() => deleteMsg(msg)} className="font-semibold text-red-500">Delete</button>
                          <button onClick={() => setConfirmDeleteId(null)} className="text-brand-muted">Cancel</button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* "N new messages" pill — only when reading history and new ones arrived */}
          {newCount > 0 && (
            <button
              type="button"
              onClick={() => { scrollToBottom(); markRead() }}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 bg-brand-dark text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg hover:bg-brand-dark/90 transition-colors"
            >
              <ArrowDown className="w-3.5 h-3.5" />
              {newCount} new message{newCount === 1 ? '' : 's'}
            </button>
          )}
        </div>

        {composer()}
      </div>
    </div>
  )
}
