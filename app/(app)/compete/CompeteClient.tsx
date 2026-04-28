'use client'

import { useState } from 'react'
import Link from 'next/link'

const SKILL_TIERS = [
  'Beginner',
  'Beginner Plus',
  'Intermediate',
  'Intermediate Plus',
  'Advanced',
] as const

type SkillTier = typeof SKILL_TIERS[number]

// DB skill_level values → display tier labels
const SKILL_LEVEL_TO_TIER: Record<string, SkillTier> = {
  beginner:          'Beginner',
  beginner_plus:     'Beginner Plus',
  intermediate:      'Intermediate',
  intermediate_plus: 'Intermediate Plus',
  advanced:          'Advanced',
}

const FORMAT_LABELS: Record<string, string> = {
  individual_round_robin: 'Individual Round Robin',
  mens_doubles:           "Men's Doubles",
  womens_doubles:         "Women's Doubles",
  mixed_doubles:          'Mixed Doubles',
  coed_doubles:           'Coed Doubles',
  singles:                'Singles',
  custom:                 'Custom',
}

const REG_BADGE: Record<string, { label: string; cls: string }> = {
  open:          { label: 'Open',         cls: 'bg-brand text-brand-dark' },
  waitlist_only: { label: 'Waitlist',     cls: 'bg-yellow-100 text-yellow-800' },
  closed:        { label: 'Closed',       cls: 'bg-red-100 text-red-700' },
  upcoming:      { label: 'Coming Soon',  cls: 'bg-brand-soft text-brand-muted' },
}

const TOURN_BADGE: Record<string, { label: string; cls: string }> = {
  upcoming:            { label: 'Coming Soon',       cls: 'bg-brand-soft text-brand-muted' },
  registration_open:   { label: 'Registration Open', cls: 'bg-brand text-brand-dark' },
  registration_closed: { label: 'Reg. Closed',       cls: 'bg-red-100 text-red-700' },
  in_progress:         { label: 'In Progress',        cls: 'bg-yellow-100 text-yellow-800' },
  completed:           { label: 'Completed',          cls: 'bg-brand-soft text-brand-muted' },
  cancelled:           { label: 'Cancelled',          cls: 'bg-red-100 text-red-700' },
}

type League = {
  id: string
  name: string
  format: string
  skill_level: string
  location_name: string | null
  start_date: string | null
  end_date: string | null
  max_players: number | null
  registration_status: string
}

type Tournament = {
  id: string
  name: string
  location_name: string | null
  start_date: string | null
  end_date: string | null
  status: string
  cost_cents: number | null
  eventSkillLevels: string[]
}

type Props = {
  leagues: League[]
  tournaments: Tournament[]
  isLoggedIn: boolean
}

function fmtDate(d: string | null, year = false) {
  if (!d) return null
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}),
  })
}

export default function CompeteClient({ leagues, tournaments, isLoggedIn }: Props) {
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
    ? leagues.filter((l) => {
        const tier = SKILL_LEVEL_TO_TIER[l.skill_level]
        return tier ? activeFilters.has(tier) : false
      })
    : leagues

  const visibleTournaments = filtering
    ? tournaments.filter((t) =>
        t.eventSkillLevels.some((sl) => {
          const tier = SKILL_LEVEL_TO_TIER[sl]
          return tier ? activeFilters.has(tier) : false
        })
      )
    : tournaments

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
            <Link href="/compete/leagues/create" className="text-xs text-brand-active font-medium underline underline-offset-2">
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
              const tier = SKILL_LEVEL_TO_TIER[league.skill_level] ?? league.skill_level
              return (
                <Link
                  key={league.id}
                  href={`/compete/leagues/${league.id}`}
                  className="block bg-brand-surface border border-brand-border rounded-2xl p-4 hover:border-brand transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-dark truncate">{league.name}</p>
                      <p className="text-xs text-brand-muted mt-0.5">
                        {FORMAT_LABELS[league.format] ?? league.format} · {tier}
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
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* Tournaments */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-base font-bold text-brand-dark">Tournaments</h2>
          {isLoggedIn && (
            <Link href="/compete/tournaments/create" className="text-xs text-brand-active font-medium underline underline-offset-2">
              + Create
            </Link>
          )}
        </div>

        {visibleTournaments.length === 0 ? (
          <p className="text-sm text-brand-muted text-center py-8">
            {filtering ? 'No tournaments match this skill level.' : 'No tournaments listed yet.'}
          </p>
        ) : (
          <div className="space-y-3">
            {visibleTournaments.map((t) => {
              const badge = TOURN_BADGE[t.status] ?? TOURN_BADGE.upcoming
              const cost = t.cost_cents ? `$${(t.cost_cents / 100).toFixed(0)}` : 'Free'
              return (
                <Link
                  key={t.id}
                  href={`/compete/tournaments/${t.id}`}
                  className="block bg-brand-surface border border-brand-border rounded-2xl p-4 hover:border-brand transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-dark truncate">{t.name}</p>
                      {t.location_name && (
                        <p className="text-xs text-brand-muted mt-0.5">📍 {t.location_name}</p>
                      )}
                      {(t.start_date || t.end_date) && (
                        <p className="text-xs text-brand-muted mt-0.5">
                          📅 {fmtDate(t.start_date)}{t.end_date ? ` – ${fmtDate(t.end_date, true)}` : ''}
                        </p>
                      )}
                      <p className="text-xs text-brand-muted mt-0.5">💰 {cost}</p>
                    </div>
                    <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
