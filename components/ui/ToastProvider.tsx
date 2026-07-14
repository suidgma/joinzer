'use client'

import { createContext, useCallback, useContext, useRef, useState } from 'react'

export type ToastTone = 'default' | 'success' | 'warn'
export type Toast = { id: string; message: string; icon?: string; tone: ToastTone }
type ToastInput = { message: string; icon?: string; tone?: ToastTone; key?: string }

const ToastContext = createContext<{ toast: (t: ToastInput) => void } | null>(null)

const AUTO_DISMISS_MS = 4000
const MAX_VISIBLE = 3
const DEDUPE_MS = 2500

// Lightweight, unobtrusive toasts for realtime awareness ("Sarah is running late"). Plain
// React — no dependency. Auto-dismiss, capped stack, and de-dupes rapid repeats of the same
// logical event so a burst of updates doesn't spam. Mounted once in the app layout.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const lastRef = useRef<{ key: string; at: number } | null>(null)

  const dismiss = useCallback((id: string) => setToasts((list) => list.filter((t) => t.id !== id)), [])

  const toast = useCallback((input: ToastInput) => {
    const key = input.key ?? input.message
    const now = Date.now()
    if (lastRef.current && lastRef.current.key === key && now - lastRef.current.at < DEDUPE_MS) return
    lastRef.current = { key, at: now }
    const id = crypto.randomUUID()
    setToasts((list) => [...list.slice(-(MAX_VISIBLE - 1)), { id, message: input.message, icon: input.icon, tone: input.tone ?? 'default' }])
    setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed z-[60] bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-4 left-1/2 -translate-x-1/2 lg:left-auto lg:right-4 lg:translate-x-0 flex flex-col items-center lg:items-end gap-2 pointer-events-none w-full max-w-xs px-3">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto w-full text-left flex items-center gap-2 rounded-xl border bg-white shadow-lg px-3 py-2.5 text-sm text-brand-dark ${
              t.tone === 'warn' ? 'border-amber-200' : t.tone === 'success' ? 'border-emerald-200' : 'border-brand-border'
            }`}
          >
            {t.icon && <span className="shrink-0">{t.icon}</span>}
            <span className="min-w-0 truncate">{t.message}</span>
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// Non-throwing: components outside the provider just no-op, so toasting stays optional.
export function useToast(): (t: ToastInput) => void {
  const ctx = useContext(ToastContext)
  return ctx?.toast ?? (() => {})
}
