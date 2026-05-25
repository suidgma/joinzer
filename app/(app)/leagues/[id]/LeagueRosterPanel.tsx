'use client'

import { useState } from 'react'
import { Crown } from 'lucide-react'
import RatingBadge from '@/components/features/RatingBadge'

const DOUBLES_FORMATS = new Set([
  'mens_doubles', 'womens_doubles', 'mixed_doubles', 'coed_doubles', 'open_doubles',
])

type Profile = {
  id: string
  name: string
  profile_photo_url: string | null
  dupr_rating: number | null
  estimated_rating: number | null
  rating_source: string | null
}

type Reg = {
  id: string
  user_id: string
  status: string
  registration_type: string | null
  partner_user_id: string | null
  is_co_admin: boolean
  profile: Profile
}

type TeamRow = {
  player1: Reg
  player2: Reg | null
}

export type RosterProps = {
  leagueId: string
  format: string
  maxPlayers: number | null
  organizerUserId: string
  registrations: Reg[]
  subInterestUserIds: Set<string>
}

function buildTeamRows(regs: Reg[]): TeamRow[] {
  const byUserId = new Map(regs.map(r => [r.user_id, r]))
  const seen = new Set<string>()
  const rows: TeamRow[] = []

  for (const reg of regs) {
    if (seen.has(reg.user_id)) continue
    seen.add(reg.user_id)

    const partnerId = reg.partner_user_id
    if (partnerId && byUserId.has(partnerId) && !seen.has(partnerId)) {
      seen.add(partnerId)
      rows.push({ player1: reg, player2: byUserId.get(partnerId)! })
    } else {
      rows.push({ player1: reg, player2: null })
    }
  }

  return rows
}

function Avatar({ profile }: { profile: Profile }) {
  const initials = profile.name
    .split(' ')
    .filter(Boolean)
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <div className="w-8 h-8 rounded-full overflow-hidden bg-brand-soft border border-brand-border flex-shrink-0 flex items-center justify-center">
      {profile.profile_photo_url ? (
        <img src={profile.profile_photo_url} alt={profile.name} className="w-full h-full object-cover" />
      ) : (
        <span className="text-[10px] font-semibold text-brand-muted leading-none">{initials}</span>
      )}
    </div>
  )
}

function PlayerRow({
  reg,
  isOrganizer,
  isSubAvailable,
}: {
  reg: Reg
  isOrganizer: boolean
  isSubAvailable: boolean
}) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Avatar profile={reg.profile} />
      <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
        <span className="text-sm font-medium text-brand-dark">{reg.profile.name}</span>
        {isOrganizer && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 leading-none whitespace-nowrap">
            <Crown size={9} />
            Organizer
          </span>
        )}
        {isSubAvailable && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-brand-soft text-brand-active leading-none whitespace-nowrap">
            ✓ can sub
          </span>
        )}
      </div>
      <div className="flex-shrink-0">
        <RatingBadge
          ratingSource={reg.profile.rating_source}
          duprRating={reg.profile.dupr_rating}
          estimatedRating={reg.profile.estimated_rating}
        />
      </div>
    </div>
  )
}

export default function LeagueRosterPanel({
  leagueId,
  format,
  maxPlayers,
  organizerUserId,
  registrations,
  subInterestUserIds,
}: RosterProps) {
  const [showSubOnly, setShowSubOnly] = useState(false)
  const [copied, setCopied] = useState(false)

  const isDoubles = DOUBLES_FORMATS.has(format)

  const registered = [...registrations.filter(r => r.status === 'registered')].sort((a, b) => {
    const fa = a.profile.name.split(' ')[0] ?? ''
    const fb = b.profile.name.split(' ')[0] ?? ''
    return fa.localeCompare(fb)
  })
  const waitlistedCount = registrations.filter(r => r.status === 'waitlist').length

  const filtered = showSubOnly
    ? registered.filter(r => subInterestUserIds.has(r.user_id))
    : registered

  const isFull = maxPlayers != null && registered.length >= maxPlayers
  const spotsOpen = maxPlayers != null ? Math.max(0, maxPlayers - registered.length) : null

  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/leagues/${leagueId}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard unavailable — silently no-op
    }
  }

  const teamRows = isDoubles ? buildTeamRows(filtered) : []

  return (
    <section className="space-y-3">

      {/* Header */}
      <div>
        <h2 className="font-heading text-base font-bold text-brand-dark">Roster</h2>
        <p className="text-xs text-brand-muted mt-0.5">
          {maxPlayers != null
            ? isFull
              ? `Full${waitlistedCount > 0 ? ` · ${waitlistedCount} on waitlist` : ''}`
              : `${registered.length}/${maxPlayers} players · ${spotsOpen} spot${spotsOpen !== 1 ? 's' : ''} open`
            : `${registered.length} registered`
          }
        </p>
      </div>

      {/* Filter chips — only shown when there are registrations */}
      {registered.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowSubOnly(false)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              !showSubOnly
                ? 'bg-brand text-brand-dark border-brand'
                : 'bg-brand-surface text-brand-muted border-brand-border hover:border-brand-active'
            }`}
          >
            Registered
          </button>
          <button
            onClick={() => setShowSubOnly(true)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              showSubOnly
                ? 'bg-brand text-brand-dark border-brand'
                : 'bg-brand-surface text-brand-muted border-brand-border hover:border-brand-active'
            }`}
          >
            Sub available
          </button>
        </div>
      )}

      {/* Empty state */}
      {registered.length === 0 && (
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-3">
          <p className="text-sm text-brand-muted">No registrations yet.</p>
          <button
            onClick={copyShareLink}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover transition-colors"
          >
            {copied ? '✓ Copied!' : 'Copy invite link'}
          </button>
        </div>
      )}

      {/* Filter produces no results */}
      {registered.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-brand-muted text-center py-4">
          No players match this filter.
        </p>
      )}

      {/* Doubles: team rows */}
      {isDoubles && filtered.length > 0 && (
        <div className="space-y-2">
          {teamRows.map(row => (
            <div
              key={row.player1.user_id}
              className="bg-brand-surface border border-brand-border rounded-2xl p-3 space-y-2.5"
            >
              <PlayerRow
                reg={row.player1}
                isOrganizer={row.player1.user_id === organizerUserId}
                isSubAvailable={subInterestUserIds.has(row.player1.user_id)}
              />
              {row.player2 ? (
                <>
                  <div className="border-t border-brand-border/60" />
                  <PlayerRow
                    reg={row.player2}
                    isOrganizer={row.player2.user_id === organizerUserId}
                    isSubAvailable={subInterestUserIds.has(row.player2.user_id)}
                  />
                </>
              ) : (
                <>
                  <div className="border-t border-brand-border/60" />
                  <p className="text-xs text-brand-muted italic pl-10">looking for partner</p>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Singles / custom: player rows */}
      {!isDoubles && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(reg => (
            <div
              key={reg.user_id}
              className="bg-brand-surface border border-brand-border rounded-2xl p-3"
            >
              <PlayerRow
                reg={reg}
                isOrganizer={reg.user_id === organizerUserId}
                isSubAvailable={subInterestUserIds.has(reg.user_id)}
              />
            </div>
          ))}
        </div>
      )}

    </section>
  )
}
