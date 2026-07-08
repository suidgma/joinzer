'use client'

import { useState } from 'react'

// Post-create "you're live" moment. Shown once (via ?created=1) right after an organizer
// creates a league/tournament — celebrates + nudges the #1 next step: share to get players.
export default function OrganizerCreatedBanner({ kind, name }: { kind: 'league' | 'tournament'; name: string }) {
  const [copied, setCopied] = useState(false)

  async function share() {
    // Share the clean detail URL (drop the ?created flag).
    const url = `${window.location.origin}${window.location.pathname}`
    if (navigator.share) {
      try { await navigator.share({ title: name, url }) } catch { /* cancelled */ }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this link:', url)
    }
  }

  return (
    <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-start gap-3">
      <span className="text-xl leading-none mt-0.5">🎉</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-green-900">Your {kind} is live!</p>
        <p className="text-xs text-green-700 mt-0.5">Share the link so players can register. The setup checklist below covers the rest.</p>
      </div>
      <button
        onClick={share}
        className="shrink-0 bg-green-600 text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-green-700 transition-colors"
      >
        {copied ? 'Copied!' : 'Share link'}
      </button>
    </div>
  )
}
