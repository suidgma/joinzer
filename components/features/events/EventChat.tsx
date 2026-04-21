'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Message = {
  id: string
  user_id: string
  message_text: string
  created_at: string
  profile: { name: string } | null
}

type Props = {
  eventId: string
  initialMessages: Message[]
  currentUserId: string
  isJoined: boolean
}

export default function EventChat({
  eventId,
  initialMessages,
  currentUserId,
  isJoined,
}: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel(`event-chat-${eventId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'event_messages',
          filter: `event_id=eq.${eventId}`,
        },
        async (payload) => {
          const row = payload.new as {
            id: string
            user_id: string
            message_text: string
            created_at: string
          }

          // Skip messages we sent ourselves — already added optimistically
          if (row.user_id === currentUserId) return

          const { data: profile } = await supabase
            .from('profiles')
            .select('name')
            .eq('id', row.user_id)
            .single()

          setMessages((prev) => [
            ...prev,
            { ...row, profile: profile ?? null },
          ])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [eventId, currentUserId])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setSending(true)
    setText('')

    // Optimistic insert so sender sees message immediately
    const optimistic: Message = {
      id: crypto.randomUUID(),
      user_id: currentUserId,
      message_text: trimmed,
      created_at: new Date().toISOString(),
      profile: null,
    }
    setMessages((prev) => [...prev, optimistic])

    const supabase = createClient()
    await supabase.from('event_messages').insert({
      event_id: eventId,
      user_id: currentUserId,
      message_text: trimmed,
    })

    setSending(false)
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold">Chat</h2>

      <div className="border rounded-xl overflow-hidden">
        <div className="h-64 overflow-y-auto p-3 space-y-2 bg-gray-50">
          {messages.length === 0 ? (
            <p className="text-xs text-gray-400 text-center pt-10">
              No messages yet
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
                    <span className="text-xs text-gray-400 mb-0.5">
                      {msg.profile?.name ?? 'Unknown'}
                    </span>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm break-words ${
                      isOwn
                        ? 'bg-black text-white rounded-br-sm'
                        : 'bg-white border rounded-bl-sm'
                    }`}
                  >
                    {msg.message_text}
                  </div>
                </div>
              )
            })
          )}
          <div ref={bottomRef} />
        </div>

        {isJoined ? (
          <form
            onSubmit={handleSend}
            className="flex gap-2 p-2 border-t bg-white"
          >
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Message…"
              className="flex-1 text-sm px-3 py-1.5 border rounded-full focus:outline-none focus:ring-2 focus:ring-black"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              className="bg-black text-white text-sm px-4 py-1.5 rounded-full font-medium disabled:opacity-40"
            >
              Send
            </button>
          </form>
        ) : (
          <p className="text-xs text-gray-400 text-center py-2 border-t">
            Join the session to chat
          </p>
        )}
      </div>
    </div>
  )
}
