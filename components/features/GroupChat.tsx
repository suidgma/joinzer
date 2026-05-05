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
  table: 'league_messages' | 'tournament_messages'
  entityId: string
  entityField: string
  initialMessages: Message[]
  currentUserId: string | null
  canChat: boolean
}

export default function GroupChat({
  table,
  entityId,
  entityField,
  initialMessages,
  currentUserId,
  canChat,
}: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
      <form onSubmit={handleSend} className="border-t bg-white">
        {sendError && (
          <p className="text-xs text-red-500 px-3 pt-2">{sendError}</p>
        )}
        <div className="flex gap-2 p-2">
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
        </div>
      </form>
    )
  }

  return (
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
      {inputArea()}
    </div>
  )
}
