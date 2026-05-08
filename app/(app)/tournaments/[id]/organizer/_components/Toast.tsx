'use client'
import { useState, useCallback } from 'react'

export function useToast() {
  const [message, setMessage] = useState<string | null>(null)
  const show = useCallback((msg: string) => {
    setMessage(msg)
    setTimeout(() => setMessage(null), 3000)
  }, [])
  return { message, show }
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-brand-dark text-white text-sm px-4 py-2.5 rounded-full shadow-lg pointer-events-none whitespace-nowrap">
      {message}
    </div>
  )
}
