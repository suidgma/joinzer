'use client'

import { useState } from 'react'
import Link from 'next/link'
import { activityLevels, selfReportedLevel } from '@/lib/rating/levels'
import PlayerInviteModal from '@/components/features/players/PlayerInviteModal'
import RatingBadge from '@/components/features/RatingBadge'

type Player = {
  id: string
  name: string
  display_name: string | null
  profile_photo_url: string | null
  self_reported_rating: number | null
  self_reported_scale: string | null
  dupr_rating: number | null
  dupr_verified: boolean
  availableToday: boolean
  timeWindows: string[]
  gender: string | null
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

// The public Joinzer Level labels (pickleball) — single source in lib/rating/levels.
const LEVEL_LABELS = activityLevels('pickleball').map((b) => b.label)


type Props = {
  players: Player[]
  sessions: Session[]
  currentUserId: string | null
}

export default function PlayersClient({ players, sessions, currentUserId }: Props) {
  const [q, setQ] = useState('')
  const [activeLabels, setActiveLabels] = useState<Set<string>>(new Set())
  const [genderFilter, setGenderFilter] = useState<'male' | 'female' | null>(null)
  const [inviteTarget, setInviteTarget] = useState<Player | null>(null)

  function toggleTier(label: string) {
    setActiveLabels((prev) => {
      const next = new Set(prev)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })
  }

  function toggleGender(g: 'male' | 'female') {
    setGenderFilter((prev) => (prev === g ? null : g))
  }

  const filtered = players.filter((p) => {
    if (q.trim()) {
      const name = (p.display_name || p.name).toLowerCase()
      if (!name.includes(q.trim().toLowerCase())) return false
    }
    if (genderFilter && p.gender !== genderFilter) return false
    if (activeLabels.size === 0) return true
    return activeLabels.has(selfReportedLevel(p.self_reported_rating))
  })

  return (
    <div className="space-y-3">
      {/* Name search */}
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search players…"
        className="w-full input-sm"
      />

      {/* Gender filter */}
      <div className="space-y-1">
        <div className="flex gap-2">
          {(['male', 'female'] as const).map((g) => (
            <button
              key={g}
              onClick={() => toggleGender(g)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                genderFilter === g
                  ? 'bg-brand text-brand-dark border-brand'
                  : 'bg-brand-surface text-brand-muted border-brand-border hover:border-brand-active'
              }`}
            >
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </button>
          ))}
        </div>
        {genderFilter && (
          <p className="text-[10px] text-brand-muted">Only players who have set their gender are shown.</p>
        )}
      </div>

      {/* Skill filter pills */}
      <div className="flex gap-2 flex-wrap">
        {LEVEL_LABELS.map((label) => {
          const active = activeLabels.has(label)
          return (
            <button
              key={label}
              onClick={() => toggleTier(label)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? 'bg-brand text-brand-dark border-brand'
                  : 'bg-brand-surface text-brand-muted border-brand-border hover:border-brand-active'
              }`}
            >
              {label}
            </button>
          )
        })}
        {(activeLabels.size > 0 || genderFilter) && (
          <button
            onClick={() => { setActiveLabels(new Set()); setGenderFilter(null) }}
            className="px-3 py-1.5 rounded-full text-xs font-medium border border-brand-border text-brand-muted hover:border-brand-active transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-brand-muted text-center py-12">
          {genderFilter
            ? 'No players have set their gender to ' + genderFilter + ' yet.'
            : 'No players match these filters.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {filtered.map((player) => {
            const displayName = player.display_name ?? player.name
            const firstName = displayName.split(' ')[0]
            const isMe = player.id === currentUserId
            const canInvite = player.availableToday && !isMe

            return (
              <Link
                key={player.id}
                href={`/players/${player.id}`}
                onClick={(e) => { if (canInvite) { e.preventDefault(); setInviteTarget(player) } }}
                className={`relative flex flex-col items-center gap-1.5 bg-brand-surface border rounded-2xl p-3 transition-colors ${
                  player.availableToday ? 'border-brand' : 'border-brand-border'
                } hover:bg-brand-soft`}
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
                    <img src={player.profile_photo_url} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    <span className="flex items-center justify-center w-full h-full text-brand-muted">
                      <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                      </svg>
                    </span>
                  )}
                </div>
                <p className="w-full px-1 text-sm font-medium text-brand-dark text-center leading-tight line-clamp-1">{displayName}</p>
                <RatingBadge
                  selfReportedRating={player.self_reported_rating}
                  selfReportedScale={player.self_reported_scale}
                  duprRating={player.dupr_rating}
                  duprVerified={player.dupr_verified}
                />
                <p className="text-xs text-brand-active font-medium text-center">
                  {selfReportedLevel(player.self_reported_rating)}
                </p>
                {canInvite && (
                  <p className="text-[10px] text-brand-active font-medium">Tap to invite</p>
                )}
              </Link>
            )
          })}
        </div>
      )}

      {inviteTarget && (
        <PlayerInviteModal
          player={{
            userId: inviteTarget.id,
            name: inviteTarget.display_name ?? inviteTarget.name,
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
