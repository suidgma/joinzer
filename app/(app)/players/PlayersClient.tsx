'use client'

import { useState } from 'react'

type Player = {
  id: string
  name: string
  profile_photo_url: string | null
  rating_source: string | null
  dupr_rating: number | null
  estimated_rating: number | null
}

type SkillOption =
  | { label: string; min?: undefined; max?: undefined }
  | { label: string; min: number; max: number }

const SKILL_OPTIONS: SkillOption[] = [
  { label: 'All levels' },
  { label: '2.0 – 2.5', min: 2.0, max: 2.5 },
  { label: '2.5 – 3.0', min: 2.5, max: 3.0 },
  { label: '3.0 – 3.5', min: 3.0, max: 3.5 },
  { label: '3.5 – 4.0', min: 3.5, max: 4.0 },
  { label: '4.0 – 4.5', min: 4.0, max: 4.5 },
  { label: '5.0+', min: 5.0, max: 99 },
]

function playerRating(p: Player): number | null {
  if (p.rating_source === 'dupr_known') return p.dupr_rating
  if (p.rating_source === 'estimated') return p.estimated_rating
  return null
}

function ratingLabel(p: Player): string {
  if (p.rating_source === 'dupr_known' && p.dupr_rating != null)
    return `DUPR ${p.dupr_rating.toFixed(2)}`
  if (p.rating_source === 'estimated' && p.estimated_rating != null)
    return `~${p.estimated_rating.toFixed(1)}`
  return ''
}

export default function PlayersClient({ players }: { players: Player[] }) {
  const [skillFilter, setSkillFilter] = useState('')

  const filtered = players.filter((p) => {
    if (!skillFilter) return true
    const option = SKILL_OPTIONS.find((o) => o.label === skillFilter)
    if (!option || option.min == null) return true
    const rating = playerRating(p)
    if (rating == null) return false
    return rating >= option.min && rating <= (option.max ?? 99)
  })

  return (
    <div className="space-y-4">
      {/* Skill filter pills */}
      <div className="flex gap-2 flex-wrap">
        {SKILL_OPTIONS.map((opt) => {
          const val = opt.label === 'All levels' ? '' : opt.label
          const active = skillFilter === val
          return (
            <button
              key={opt.label}
              onClick={() => setSkillFilter(val)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? 'bg-brand text-brand-dark border-brand'
                  : 'bg-brand-surface text-brand-muted border-brand-border hover:border-brand-active'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-brand-muted text-center py-12">No players match this skill range.</p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {filtered.map((player) => {
            const label = ratingLabel(player)
            const firstName = player.name.split(' ')[0]
            return (
              <div
                key={player.id}
                className="flex flex-col items-center gap-1.5 bg-brand-surface border border-brand-border rounded-2xl p-3"
              >
                <div className="relative w-16 h-16 rounded-full overflow-hidden bg-brand-soft border border-brand-border flex-shrink-0">
                  {player.profile_photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={player.profile_photo_url} alt={firstName} className="w-full h-full object-cover" />
                  ) : (
                    <span className="flex items-center justify-center w-full h-full text-brand-muted">
                      <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                      </svg>
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-brand-dark text-center leading-tight">{firstName}</p>
                {label && (
                  <p className="text-xs text-brand-muted text-center">{label}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
