'use client'

import { useState } from 'react'
import { joinzerRatingLabel } from '@/lib/utils/date'
import PlayerInviteModal from '@/components/features/players/PlayerInviteModal'

type Player = {
  id: string
  name: string
  profile_photo_url: string | null
  rating_source: string | null
  dupr_rating: number | null
  estimated_rating: number | null
  availableToday: boolean
  timeWindows: string[]
  joinzer_rating: number
}

type Session = {
  id: string
  title: string
  starts_at: string
  location_name: string
}

const TIME_LABELS: Record<string, string> = {
  morning: 'AM',
  afternoon: 'PM',
  evening: 'Eve',
}

type SkillTier = { label: string; min: number; max: number }

const SKILL_TIERS: SkillTier[] = [
  { label: 'Beginner',          min: 0,    max: 899  },
  { label: 'Beginner Plus',     min: 900,  max: 999  },
  { label: 'Intermediate',      min: 1000, max: 1099 },
  { label: 'Intermediate Plus', min: 1100, max: 1199 },
  { label: 'Advanced',          min: 1200, max: 99999 },
]

function ratingLabel(p: Player): string {
  if (p.rating_source === 'dupr_known' && p.dupr_rating != null)
    return `DUPR ${p.dupr_rating.toFixed(2)}`
  if (p.rating_source === 'estimated' && p.estimated_rating != null)
    return `~${p.estimated_rating.toFixed(1)}`
  return ''
}

type Props = {
  players: Player[]
  sessions: Session[]
  currentUserId: string | null
}

export default function PlayersClient({ players, sessions, currentUserId }: Props) {
  const [activeLabels, setActiveLabels] = useState<Set<string>>(new Set())
  const [inviteTarget, setInviteTarget] = useState<Player | null>(null)

  function toggleTier(label: string) {
    setActiveLabels((prev) => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })
  }

  const filtered = players.filter((p) => {
    if (activeLabels.size === 0) return true
    const tier = SKILL_TIERS.find((t) => p.joinzer_rating >= t.min && p.joinzer_rating <= t.max)
    return tier ? activeLabels.has(tier.label) : false
  })

  return (
    <div className="space-y-4">
      {/* Skill filter pills */}
      <div className="flex gap-2 flex-wrap">
        {SKILL_TIERS.map((tier) => {
          const active = activeLabels.has(tier.label)
          return (
            <button
              key={tier.label}
              onClick={() => toggleTier(tier.label)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? 'bg-brand text-brand-dark border-brand'
                  : 'bg-brand-surface text-brand-muted border-brand-border hover:border-brand-active'
              }`}
            >
              {tier.label}
            </button>
          )
        })}
        {activeLabels.size > 0 && (
          <button
            onClick={() => setActiveLabels(new Set())}
            className="px-3 py-1 rounded-full text-xs font-medium border border-brand-border text-brand-muted hover:border-brand-active transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-brand-muted text-center py-12">No players match this skill range.</p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {filtered.map((player) => {
            const label = ratingLabel(player)
            const firstName = player.name.split(' ')[0]
            const isMe = player.id === currentUserId
            const canInvite = player.availableToday && !isMe

            return (
              <div
                key={player.id}
                onClick={() => canInvite && setInviteTarget(player)}
                className={`relative flex flex-col items-center gap-1.5 bg-brand-surface border rounded-2xl p-3 transition-colors ${
                  player.availableToday ? 'border-brand' : 'border-brand-border'
                } ${canInvite ? 'cursor-pointer hover:bg-brand-soft' : ''}`}
              >
                {player.availableToday && (
                  <span className="absolute top-2 right-2 bg-brand text-brand-dark text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                    {player.timeWindows.length === 3
                      ? 'All'
                      : player.timeWindows.map((w) => TIME_LABELS[w]).join('/')}
                  </span>
                )}
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
                <p className="text-xs text-brand-active font-medium text-center">
                  {joinzerRatingLabel(player.joinzer_rating)}
                </p>
                {canInvite && (
                  <p className="text-[10px] text-brand-active font-medium">Tap to invite</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {inviteTarget && (
        <PlayerInviteModal
          player={{
            userId: inviteTarget.id,
            name: inviteTarget.name,
            photoUrl: inviteTarget.profile_photo_url,
            timeWindows: inviteTarget.timeWindows,
          }}
          sessions={sessions}
          onClose={() => setInviteTarget(null)}
        />
      )}
    </div>
  )
}
