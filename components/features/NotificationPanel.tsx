'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { X, Bell, Trophy, BarChart2, Zap } from 'lucide-react'

interface Notification {
  id: string
  surface: 'event' | 'league' | 'tournament' | 'system'
  kind: string
  title: string
  body: string | null
  url: string | null
  read_at: string | null
  created_at: string
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function SurfaceIcon({ surface }: { surface: string }) {
  const base = 'w-8 h-8 rounded-full flex items-center justify-center shrink-0'
  if (surface === 'tournament') return <div className={`${base} bg-yellow-100 text-yellow-700`}><Trophy className="w-4 h-4" /></div>
  if (surface === 'league') return <div className={`${base} bg-blue-100 text-blue-700`}><BarChart2 className="w-4 h-4" /></div>
  if (surface === 'event') return <div className={`${base} bg-green-100 text-green-700`}><Zap className="w-4 h-4" /></div>
  return <div className={`${base} bg-gray-100 text-gray-500`}><Bell className="w-4 h-4" /></div>
}

function NotificationItem({
  n,
  onRead,
  onClose,
}: {
  n: Notification
  onRead: (id: string) => void
  onClose: () => void
}) {
  const isUnread = !n.read_at

  const handleInteract = () => {
    if (isUnread) onRead(n.id)
    if (n.url) onClose()
  }

  const className = `w-full flex gap-3 px-4 py-3 text-left border-b border-brand-border hover:bg-brand-page transition-colors ${
    isUnread ? 'bg-brand-soft' : ''
  }`

  const content = (
    <>
      <SurfaceIcon surface={n.surface} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-snug ${isUnread ? 'font-semibold text-brand-dark' : 'text-brand-dark'}`}>
          {n.title}
        </p>
        {n.body && (
          <p className="text-xs text-brand-muted mt-0.5 line-clamp-2">{n.body}</p>
        )}
        <p className="text-xs text-brand-muted mt-1">{timeAgo(n.created_at)}</p>
      </div>
      {isUnread && (
        <div className="shrink-0 mt-2 w-2 h-2 rounded-full bg-red-500" />
      )}
    </>
  )

  if (n.url) {
    return (
      <Link href={n.url} className={className} onClick={handleInteract}>
        {content}
      </Link>
    )
  }
  return (
    <button className={className} onClick={handleInteract}>
      {content}
    </button>
  )
}

interface Props {
  onClose: () => void
  onMarkAllRead: () => void
}

export default function NotificationPanel({ onClose, onMarkAllRead }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/notifications')
      .then(r => r.json())
      .then(data => {
        setNotifications(data.notifications ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const markAllRead = async () => {
    await fetch('/api/notifications/read-all', { method: 'POST' })
    setNotifications(prev => prev.map(n => ({ ...n, read_at: new Date().toISOString() })))
    onMarkAllRead()
  }

  const markRead = async (id: string) => {
    await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' })
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n)
    )
  }

  const unreadCount = notifications.filter(n => !n.read_at).length

  return (
    <>
      {/* Backdrop — closes panel on outside click */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-14 right-0 left-0 md:left-auto md:right-4 md:w-80 bg-brand-surface border border-brand-border shadow-xl z-50 md:rounded-xl overflow-hidden flex flex-col max-h-[calc(100vh-3.5rem)]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-brand-border shrink-0">
          <span className="font-semibold text-sm text-brand-dark">Notifications</span>
          <div className="flex items-center gap-3">
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-brand-muted hover:text-brand-dark transition-colors"
              >
                Mark all read
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-brand-page transition-colors text-brand-muted hover:text-brand-dark"
              aria-label="Close notifications"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-brand-muted">Loading…</div>
          ) : notifications.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Bell className="w-8 h-8 text-brand-muted mx-auto mb-2 opacity-40" />
              <p className="text-sm text-brand-muted font-medium">You're all caught up!</p>
            </div>
          ) : (
            notifications.map(n => (
              <NotificationItem
                key={n.id}
                n={n}
                onRead={markRead}
                onClose={onClose}
              />
            ))
          )}
        </div>
      </div>
    </>
  )
}
