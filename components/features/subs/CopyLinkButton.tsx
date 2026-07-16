'use client'

import { useState } from 'react'
import { Share2, Check } from 'lucide-react'

// Share via the Web Share API where available, else copy to clipboard, with accessible feedback.
export default function CopyLinkButton({ path, label = 'Share', className }: { path: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  async function share() {
    const url = typeof window !== 'undefined' ? window.location.origin + path : path
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ url })
        return
      }
    } catch { /* user cancelled share — fall through to copy */ }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }

  return (
    <button
      onClick={share}
      className={className ?? 'inline-flex items-center gap-1.5 text-xs font-semibold text-brand-active hover:text-brand-dark'}
      aria-live="polite"
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
      {copied ? 'Link copied' : label}
    </button>
  )
}
