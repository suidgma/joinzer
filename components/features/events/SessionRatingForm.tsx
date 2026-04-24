'use client'

import { useState } from 'react'

type Player = { userId: string; name: string }

type Props = {
  eventId: string
  players: Player[]
  alreadyRated: boolean
}

const OPTIONS = [
  { score: -1, label: 'Below me', emoji: '👇' },
  { score:  0, label: 'My level', emoji: '🤝' },
  { score:  1, label: 'Above me', emoji: '👆' },
]

export default function SessionRatingForm({ eventId, players, alreadyRated }: Props) {
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [submitted, setSubmitted] = useState(alreadyRated)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setRating(userId: string, score: number) {
    setRatings((prev) => ({ ...prev, [userId]: score }))
  }

  async function handleSubmit() {
    const entries = Object.entries(ratings)
    if (entries.length === 0) return

    setLoading(true)
    setError(null)

    const res = await fetch('/api/rate-players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        ratings: entries.map(([userId, score]) => ({ userId, score })),
      }),
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error ?? 'Failed to submit ratings')
      setLoading(false)
      return
    }

    setSubmitted(true)
    setLoading(false)
  }

  if (submitted) {
    return (
      <div className="bg-brand-soft border border-brand-border rounded-2xl p-4 text-center space-y-1">
        <p className="text-sm font-medium text-brand-dark">Ratings submitted ✓</p>
        <p className="text-xs text-brand-muted">Player skill scores have been updated.</p>
      </div>
    )
  }

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-4">
      <div>
        <h2 className="font-heading text-sm font-semibold text-brand-dark">Rate your players</h2>
        <p className="text-xs text-brand-muted mt-0.5">How did each player compare to your skill level?</p>
      </div>

      <div className="space-y-3">
        {players.map((player) => (
          <div key={player.userId}>
            <p className="text-sm font-medium text-brand-dark mb-1.5">{player.name}</p>
            <div className="flex gap-2">
              {OPTIONS.map((opt) => {
                const selected = ratings[player.userId] === opt.score
                return (
                  <button
                    key={opt.score}
                    type="button"
                    onClick={() => setRating(player.userId, opt.score)}
                    className={`flex-1 py-2 rounded-xl border text-xs font-medium transition-colors ${
                      selected
                        ? 'bg-brand border-brand text-brand-dark'
                        : 'bg-brand-soft border-brand-border text-brand-muted'
                    }`}
                  >
                    <span className="block text-base leading-none mb-0.5">{opt.emoji}</span>
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={Object.keys(ratings).length === 0 || loading}
        className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
      >
        {loading ? 'Submitting…' : `Submit ratings (${Object.keys(ratings).length}/${players.length})`}
      </button>
      <p className="text-xs text-brand-muted text-center">You can skip individual players — only rated players are updated.</p>
    </div>
  )
}
