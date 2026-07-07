'use client'

import { useState } from 'react'
import { Share2, Check, Copy } from 'lucide-react'

// Organizer-only control on the Standings page: toggle a public, no-login results
// page at /l/[id] and copy the shareable link. Off by default.
export default function StandingsShareCard({ leagueId, initialEnabled }: { leagueId: string; initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const publicUrl = typeof window !== 'undefined' ? `${window.location.origin}/l/${leagueId}` : `/l/${leagueId}`

  async function toggle() {
    const next = !enabled
    setBusy(true)
    setEnabled(next) // optimistic
    try {
      const res = await fetch(`/api/leagues/${leagueId}/public-standings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) setEnabled(!next) // revert on failure
    } catch {
      setEnabled(!next)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable */ }
  }

  return (
    <div className="bg-brand-soft border border-brand-border rounded-2xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Share2 className="w-4 h-4 text-brand-active shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-brand-dark">Public results</p>
            <p className="text-[11px] text-brand-muted">Share a live standings link anyone can open — no login.</p>
          </div>
        </div>
        <button
          onClick={toggle}
          disabled={busy}
          aria-label="Toggle public results"
          className={`w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-50 ${enabled ? 'bg-brand' : 'bg-gray-200'}`}
        >
          <div className={`w-4 h-4 bg-white rounded-full shadow m-0.5 transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>
      {enabled && (
        <div className="flex items-center gap-2">
          <input readOnly value={publicUrl} className="flex-1 min-w-0 text-xs input py-1.5 bg-white" onFocus={(e) => e.currentTarget.select()} />
          <button onClick={copy} className="flex items-center gap-1 text-xs font-semibold bg-brand text-brand-dark px-2.5 py-1.5 rounded-lg hover:bg-brand-hover whitespace-nowrap">
            {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
          </button>
        </div>
      )}
    </div>
  )
}
