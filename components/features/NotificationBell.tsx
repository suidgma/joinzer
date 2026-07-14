'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell } from 'lucide-react'
import NotificationPanel from './NotificationPanel'
import { useRealtimeChannel } from '@/lib/realtime/hooks'
import { useToast } from '@/components/ui/ToastProvider'
import { notificationsTopic, RealtimeEvents } from '@/lib/realtime/topics'

export default function NotificationBell({ userId }: { userId: string | null }) {
  const [unread, setUnread] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const toast = useToast()

  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=1')
      if (!res.ok) return
      const data = await res.json()
      setUnread(data.unread ?? 0)
    } catch {
      // non-blocking — bell stays at zero if request fails
    }
  }, [])

  // Poll is now a fallback (the realtime broadcast below is instant); keep it slow.
  useEffect(() => {
    fetchUnread()
    const interval = setInterval(fetchUnread, 120_000)
    return () => clearInterval(interval)
  }, [fetchUnread])

  // Live: a new notification toasts + re-fetches the authoritative unread count.
  useRealtimeChannel(
    userId ? { topic: notificationsTopic(userId), broadcast: [RealtimeEvents.notificationCreated] } : null,
    (evt) => {
      if (evt.kind !== 'broadcast') return
      const p = evt.payload as { title?: string }
      if (p.title) toast({ message: p.title, icon: '🔔', key: 'notif' })
      fetchUnread()
    },
  )

  const handleClose = () => setIsOpen(false)
  const handleMarkAllRead = () => setUnread(0)

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="relative p-2 rounded-lg text-brand-muted hover:text-brand-dark hover:bg-brand-soft transition-colors"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[1rem] h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {isOpen && (
        <NotificationPanel
          onClose={handleClose}
          onMarkAllRead={handleMarkAllRead}
        />
      )}
    </div>
  )
}
