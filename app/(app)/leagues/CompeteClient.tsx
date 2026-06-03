'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatSessionDate } from '@/lib/utils/date'
import { formatSkillRange } from '@/lib/taxonomy/formats'

const SKILL_TIERS = [
  'Beginner',
  'Beginner Plus',
  'Intermediate',
  'Intermediate Plus',
  'Advanced',
] as const

type SkillTier = typeof SKILL_TIERS[number]

// Numeric range for each tier pill — used for overlap filtering
const TIER_RANGES: Record<SkillTier, [number, number]> = {
  'Beginner':          [2.0, 2.5],
  'Beginner Plus':     [2.5, 3.0],
  'Intermediate':      [3.0, 3.5],
  'Intermediate Plus': [3.5, 4.0],
  'Advanced':          [4.0, 4.5],
}

const FORMAT_LABELS: Record<string, string> = {
  individual_round_robin: 'Individual Round Robin',
  mens_doubles:   "Men's Doubles",
  womens_doubles: "Women's Doubles",
  mixed_doubles:  'Mixed Doubles',
  coed_doubles:   'Coed Doubles',
  open_doubles:   'Open Doubles',
  mens_singles:   "Men's Singles",
  womens_singles: "Women's Singles",
  open_singles:   'Open Singles',
  singles:        'Singles',
  custom:         'Custom',
}

const REG_BADGE: Record<string, { label: string; cls: string }> = {
  open:          { label: 'Open',         cls: 'bg-brand text-brand-dark' },
  waitlist_only: { label: 'Waitlist',     cls: 'bg-yellow-100 text-yellow-800' },
  closed:        { label: 'Closed',       cls: 'bg-red-100 text-red-700' },
  upcoming:      { label: 'Coming Soon',  cls: 'bg-brand-soft text-brand-muted' },
}


type League = {
  id: string
  name: string
  format: string
  skill_min: number | null
  skill_max: number | null
  location_name: string | null
  start_date: string | null
  end_date: string | null
  max_players: number | null
  registration_status: string
  creator: { name: string } | null
}

type Props = {
  leagues: League[]
  isLoggedIn: boolean
}

function fmtDate(d: string | null, year = false) {
  if (!d) return null
  return formatSessionDate(d, {
    weekday: undefined, month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}),
  })
}

export default function CompeteClient({ leagues, isLoggedIn }: Props) {
  const [activeFilters, setActiveFilters] = useState<Set<SkillTier>>(new Set())

  function toggleTier(tier: SkillTier) {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      next.has(tier) ? next.delete(tier) : next.add(tier)
      return next
    })
  }

  const filtering = activeFilters.size > 0

  const visibleLeagues = filtering
    ? leagues.filter((l) =>
        Array.from(activeFilters).some((tier) => {
          const [lo, hi] = TIER_RANGES[tier]
          return l.skill_min != null && l.skill_max != null && l.skill_min <= hi && l.skill_max >= lo
        })
      )
    : leagues

  return (
    <div className="space-y-6">
      {/* Skill filter pills */}
      <div className="flex gap-2 flex-wrap">
        {SKILL_TIERS.map((tier) => {
          const active = activeFilters.has(tier)
          return (
            <button
              key={tier}
              onClick={() => toggleTier(tier)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? 'bg-brand text-brand-dark border-brand'
                  : 'bg-brand-surface text-brand-muted border-brand-border hover:border-brand-active'
              }`}
            >
              {tier}
            </button>
          )
        })}
        {filtering && (
          <button
            onClick={() => setActiveFilters(new Set())}
            className="px-3 py-1 rounded-full text-xs font-medium border border-brand-border text-brand-muted hover:border-brand-active transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Leagues */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base font-bold text-brand-dark">Leagues</h2>
          {isLoggedIn && (
            <Link href="/leagues/create" className="text-xs text-brand-active font-medium underline underline-offset-2">
              + Create
            </Link>
          )}
        </div>

        {visibleLeagues.length === 0 ? (
          <p className="text-sm text-brand-muted text-center py-8">
            {filtering ? 'No leagues match this skill level.' : 'No active leagues yet.'}
          </p>
        ) : (
          <div className="space-y-3">
            {visibleLeagues.map((league) => {
              const badge = REG_BADGE[league.registration_status] ?? REG_BADGE.upcoming
              const skillLabel = formatSkillRange(league.skill_min, league.skill_max)
              return (
                <Link
                  key={league.id}
                  href={`/leagues/${league.id}`}
                  className="block bg-brand-surface border border-brand-border rounded-2xl p-4 hover:border-brand transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-dark truncate">{league.name}</p>
                      <p className="text-xs text-brand-muted mt-0.5">
                        {FORMAT_LABELS[league.format] ?? league.format}{skillLabel ? ` · ${skillLabel}` : ''}
                      </p>
                      {league.location_name && (
                        <p className="text-xs text-brand-muted mt-0.5">📍 {league.location_name}</p>
                      )}
                      {(league.start_date || league.end_date) && (
                        <p className="text-xs text-brand-muted mt-0.5">
                          📅 {fmtDate(league.start_date)}{league.end_date ? ` – ${fmtDate(league.end_date, true)}` : ''}
                        </p>
                      )}
                    </div>
                    <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                  {league.creator?.name && (
                    <p className="text-xs text-brand-muted pt-1.5 border-t border-brand-border">
                      Organizer: {league.creator.name}
                    </p>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </section>

    </div>
  )
}
