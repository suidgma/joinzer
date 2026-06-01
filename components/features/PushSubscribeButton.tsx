'use client'

import { useState, useEffect } from 'react'
import { Bell, BellOff, BellRing } from 'lucide-react'

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const buffer = new ArrayBuffer(rawData.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i)
  return buffer
}

type Status = 'loading' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed'

interface Props {
  /** Compact pill style for the notification panel; default is a full-width profile row */
  compact?: boolean
}

export default function PushSubscribeButton({ compact = false }: Props) {
  const [status, setStatus] = useState<Status>('loading')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setStatus('denied')
      return
    }
    navigator.serviceWorker.ready.then(async (reg) => {
      const existing = await reg.pushManager.getSubscription()
      setStatus(existing ? 'subscribed' : 'unsubscribed')
    })
  }, [])

  async function enable() {
    setBusy(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus('denied')
        return
      }

      const reg = await navigator.serviceWorker.ready
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
        ),
      })

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      })

      setStatus('subscribed')
    } catch (err) {
      console.error('[push] subscribe failed:', err)
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const subscription = await reg.pushManager.getSubscription()
      if (subscription) await subscription.unsubscribe()

      await fetch('/api/push/subscribe', { method: 'DELETE' })
      setStatus('unsubscribed')
    } catch (err) {
      console.error('[push] unsubscribe failed:', err)
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading' || status === 'unsupported') return null

  if (compact) {
    // Small pill for the NotificationPanel footer
    if (status === 'denied') {
      return (
        <p className="text-[11px] text-brand-muted text-center py-2 px-4">
          Notifications blocked — enable in browser settings.
        </p>
      )
    }
    if (status === 'subscribed') {
      return (
        <button
          onClick={disable}
          disabled={busy}
          className="flex items-center gap-1.5 text-[11px] text-brand-muted hover:text-brand-dark transition-colors disabled:opacity-50"
        >
          <BellOff className="w-3 h-3" />
          {busy ? 'Turning off…' : 'Turn off push notifications'}
        </button>
      )
    }
    return (
      <button
        onClick={enable}
        disabled={busy}
        className="flex items-center gap-1.5 text-[11px] text-brand-active font-medium hover:underline disabled:opacity-50"
      >
        <BellRing className="w-3 h-3" />
        {busy ? 'Enabling…' : 'Enable push notifications'}
      </button>
    )
  }

  // Full-width row for profile settings
  if (status === 'denied') {
    return (
      <div className="flex items-center gap-3 py-2">
        <BellOff className="w-4 h-4 text-brand-muted shrink-0" />
        <div>
          <p className="text-sm font-medium text-brand-dark">Push notifications blocked</p>
          <p className="text-xs text-brand-muted">Enable in your browser&apos;s site settings to receive alerts.</p>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={status === 'subscribed' ? disable : enable}
      disabled={busy}
      className="flex items-center gap-3 w-full text-left py-2 disabled:opacity-50"
    >
      {status === 'subscribed'
        ? <Bell className="w-4 h-4 text-brand-active shrink-0" />
        : <Bell className="w-4 h-4 text-brand-muted shrink-0" />
      }
      <div>
        <p className="text-sm font-medium text-brand-dark">
          {busy
            ? status === 'subscribed' ? 'Turning off…' : 'Enabling…'
            : status === 'subscribed' ? 'Push notifications on' : 'Enable push notifications'
          }
        </p>
        <p className="text-xs text-brand-muted">
          {status === 'subscribed'
            ? 'You\'ll be notified about matches, sub requests, and league updates.'
            : 'Get notified about matches, sub requests, and league updates.'}
        </p>
      </div>
      <div className={`ml-auto w-9 h-5 rounded-full transition-colors shrink-0 ${status === 'subscribed' ? 'bg-brand' : 'bg-gray-200'}`}>
        <div className={`w-4 h-4 bg-white rounded-full shadow m-0.5 transition-transform ${status === 'subscribed' ? 'translate-x-4' : 'translate-x-0'}`} />
      </div>
    </button>
  )
}
