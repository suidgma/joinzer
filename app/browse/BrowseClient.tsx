'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { EventListItem, TournamentListItem, LocationOption } from '@/lib/types'

// ---- types ----

type Category = 'all' | 'open_play' | 'league' | 'tournament' | 'clinic' | 'court'

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'all',        label: 'All' },
  { id: 'open_play',  label: 'Open Play' },
  { id: 'league',     label: 'Leagues' },
  { id: 'tournament', label: 'Tournaments' },
  { id: 'clinic',     label: 'Clinics' },
  { id: 'court',      label: 'Courts' },
]

type LeagueItem = {
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
  events: EventListItem[]
  leagues: LeagueItem[]
  tournaments: TournamentListItem[]
  locations: LocationOption[]
}

// ---- helpers ----

function fmtDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function fmtDateTime(isoStr: string) {
  return new Date(isoStr).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function fmtTime(timeStr: string) {
  const [h, m] = timeStr.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

function skillLabel(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null
  const f = (n: number) => n.toFixed(1)
  if (min != null && max != null) return `${f(min)}–${f(max)}`
  if (min != null) return `${f(min)}+`
  return null
}

const FORMAT_LABELS: Record<string, string> = {
  individual_round_robin: 'Round Robin',
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

const ACCESS_LABELS: Record<string, string> = {
  public:       'Public',
  private:      'Private',
  resort:       'Resort',
  fee_based:    'Fee-based',
  business:     'Business',
  hoa:          'HOA',
  indoor_public:'Indoor',
  semi_private: 'Semi-private',
}

const TYPE_BADGES: Record<string, { label: string; cls: string }> = {
  open_play:  { label: 'Open Play',   cls: 'bg-brand/20 text-brand-active' },
  clinic:     { label: 'Clinic',      cls: 'bg-amber-100 text-amber-700' },
  league:     { label: 'League',      cls: 'bg-teal-100 text-teal-700' },
  tournament: { label: 'Tournament',  cls: 'bg-indigo-100 text-indigo-700' },
  court:      { label: 'Court',       cls: 'bg-gray-100 text-gray-600' },
}

const LEAGUE_REG_BADGES: Record<string, { label: string; cls: string }> = {
  open:          { label: 'Open',        cls: 'bg-brand text-brand-dark' },
  waitlist_only: { label: 'Waitlist',    cls: 'bg-yellow-100 text-yellow-800' },
  closed:        { label: 'Closed',      cls: 'bg-gray-100 text-gray-500' },
  upcoming:      { label: 'Coming Soon', cls: 'bg-brand-soft text-brand-muted' },
}

// ---- badge sub-components ----

function TypeBadge({ type }: { type: string }) {
  const { label, cls } = TYPE_BADGES[type] ?? { label: type, cls: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`text-[10px] font-extrabold tracking-widest px-2 py-0.5 rounded-full uppercase ${cls}`}>
      {label}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const badges: Record<string, { label: string; cls: string }> = {
    open:     { label: 'Open',        cls: 'bg-brand-soft text-brand-active' },
    full:     { label: 'Full',        cls: 'bg-gray-100 text-gray-500' },
    waitlist: { label: 'Waitlist',    cls: 'bg-yellow-100 text-yellow-700' },
    closed:   { label: 'Closed',      cls: 'bg-gray-100 text-gray-500' },
    upcoming: { label: 'Coming Soon', cls: 'bg-brand-soft text-brand-muted' },
  }
  const { label, cls } = badges[status] ?? badges.upcoming
  return (
    <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
  )
}

// ---- card sub-components ----

function EventCard({ event, type }: { event: EventListItem; type: 'open_play' | 'clinic' }) {
  const joined = (event.event_participants ?? []).filter(p => p.participant_status === 'joined').length
  const isFull = event.status === 'full'
  const skill = skillLabel(event.skill_min, event.skill_max)
  const isPaid = event.session_type === 'paid_clinic' && (event.price_cents ?? 0) > 0

  return (
    <Link href={`/play/${event.id}`} className="block">
      <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 hover:border-brand hover:shadow-sm transition-all space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <TypeBadge type={type} />
            {isPaid && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                ${((event.price_cents ?? 0) / 100).toFixed(0)}
              </span>
            )}
          </div>
          <StatusBadge status={isFull ? 'full' : 'open'} />
        </div>
        <h3 className="font-semibold text-sm text-brand-dark leading-tight">{event.title}</h3>
        <div className="space-y-0.5">
          <p className="text-xs text-brand-muted">{fmtDateTime(event.starts_at)}</p>
          {event.location?.name && <p className="text-xs text-brand-muted">📍 {event.location.name}</p>}
          {skill && <p className="text-xs text-brand-muted">Skill: {skill}</p>}
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-brand-border">
          <p className="text-xs text-brand-muted">{joined} / {event.max_players} spots</p>
          <span className="text-xs font-semibold text-brand-active">View →</span>
        </div>
      </div>
    </Link>
  )
}

function LeagueCard({ league }: { league: LeagueItem }) {
  const badge = LEAGUE_REG_BADGES[league.registration_status] ?? LEAGUE_REG_BADGES.upcoming
  const skill = skillLabel(league.skill_min, league.skill_max)
  const formatLabel = FORMAT_LABELS[league.format] ?? league.format

  return (
    <Link href={`/leagues/${league.id}`} className="block">
      <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 hover:border-brand hover:shadow-sm transition-all space-y-2">
        <div className="flex items-center justify-between gap-2">
          <TypeBadge type="league" />
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
        </div>
        <h3 className="font-semibold text-sm text-brand-dark leading-tight">{league.name}</h3>
        <div className="space-y-0.5">
          <p className="text-xs text-brand-muted">{formatLabel}{skill ? ` · ${skill}` : ''}</p>
          {league.location_name && <p className="text-xs text-brand-muted">📍 {league.location_name}</p>}
          {league.start_date && (
            <p className="text-xs text-brand-muted">
              📅 {fmtDate(league.start_date)}{league.end_date ? ` – ${fmtDate(league.end_date)}` : ''}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-brand-border">
          {league.creator?.name
            ? <p className="text-xs text-brand-muted">Organizer: {league.creator.name}</p>
            : <span />}
          <span className="text-xs font-semibold text-brand-active">View →</span>
        </div>
      </div>
    </Link>
  )
}

function TournamentCard({ tournament }: { tournament: TournamentListItem }) {
  const regOpen = tournament.registration_status === 'open'

  return (
    <Link href={`/tournaments/${tournament.id}`} className="block">
      <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 hover:border-brand hover:shadow-sm transition-all space-y-2">
        <div className="flex items-center justify-between gap-2">
          <TypeBadge type="tournament" />
          <StatusBadge status={regOpen ? 'open' : 'closed'} />
        </div>
        <h3 className="font-semibold text-sm text-brand-dark leading-tight">{tournament.name}</h3>
        <div className="space-y-0.5">
          <p className="text-xs text-brand-muted">{fmtDate(tournament.start_date)} · {fmtTime(tournament.start_time)}</p>
          {tournament.location?.name && <p className="text-xs text-brand-muted">📍 {tournament.location.name}</p>}
          {tournament.description && (
            <p className="text-xs text-brand-muted line-clamp-2 leading-relaxed">{tournament.description}</p>
          )}
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-brand-border">
          {tournament.organizer?.name
            ? <p className="text-xs text-brand-muted">Organizer: {tournament.organizer.name}</p>
            : <span />}
          <span className="text-xs font-semibold text-brand-active">View →</span>
        </div>
      </div>
    </Link>
  )
}

function CourtCard({ location }: { location: LocationOption }) {
  const accessLabel = ACCESS_LABELS[location.access_type] ?? location.access_type

  return (
    <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <TypeBadge type="court" />
        <span className="text-[10px] text-brand-muted font-medium">{accessLabel}</span>
      </div>
      <h3 className="font-semibold text-sm text-brand-dark leading-tight">{location.name}</h3>
      <div className="space-y-0.5">
        {location.subarea && <p className="text-xs text-brand-muted">📍 {location.subarea}</p>}
        {location.court_count > 0 && (
          <p className="text-xs text-brand-muted">{location.court_count} court{location.court_count !== 1 ? 's' : ''}</p>
        )}
      </div>
    </div>
  )
}

// ---- main component ----

export default function BrowseClient({ events, leagues, tournaments, locations }: Props) {
  const [category, setCategory] = useState<Category>('all')
  const [search, setSearch] = useState('')
  const [regFilter, setRegFilter] = useState<'all' | 'open'>('all')

  const q = search.trim().toLowerCase()

  const openPlay  = useMemo(() => events.filter(e => e.session_type === 'game'), [events])
  const clinics   = useMemo(() => events.filter(e => e.session_type === 'free_clinic' || e.session_type === 'paid_clinic'), [events])

  const filteredOpenPlay = useMemo(() => openPlay.filter(e => {
    if (q && !e.title.toLowerCase().includes(q)) return false
    if (regFilter === 'open' && e.status !== 'open') return false
    return true
  }), [openPlay, q, regFilter])

  const filteredLeagues = useMemo(() => leagues.filter(l => {
    if (q && !l.name.toLowerCase().includes(q) && !(l.location_name?.toLowerCase().includes(q))) return false
    if (regFilter === 'open' && l.registration_status !== 'open') return false
    return true
  }), [leagues, q, regFilter])

  const filteredTournaments = useMemo(() => tournaments.filter(t => {
    if (q && !t.name.toLowerCase().includes(q) && !(t.location?.name.toLowerCase().includes(q))) return false
    if (regFilter === 'open' && t.registration_status !== 'open') return false
    return true
  }), [tournaments, q, regFilter])

  const filteredClinics = useMemo(() => clinics.filter(e => {
    if (q && !e.title.toLowerCase().includes(q)) return false
    if (regFilter === 'open' && e.status !== 'open') return false
    return true
  }), [clinics, q, regFilter])

  const filteredCourts = useMemo(() => locations.filter(l => {
    if (q && !l.name.toLowerCase().includes(q) && !(l.subarea?.toLowerCase().includes(q))) return false
    return true
  }), [locations, q])

  const showOpenPlay   = (category === 'all' || category === 'open_play')  && filteredOpenPlay.length > 0
  const showLeagues    = (category === 'all' || category === 'league')      && filteredLeagues.length > 0
  const showTournaments= (category === 'all' || category === 'tournament')  && filteredTournaments.length > 0
  const showClinics    = (category === 'all' || category === 'clinic')      && filteredClinics.length > 0
  const showCourts     = (category === 'all' || category === 'court')       && filteredCourts.length > 0
  const hasResults     = showOpenPlay || showLeagues || showTournaments || showClinics || showCourts
  const hasActiveFilters = q.length > 0 || regFilter !== 'all'

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-brand-dark">Browse local pickleball</h1>
        <p className="text-sm text-brand-muted mt-1">
          Explore open play, leagues, tournaments, clinics, and courts in Las Vegas.{' '}
          <Link href="/login" className="text-brand-active font-medium hover:underline">
            Create a free account
          </Link>{' '}
          to join.
        </p>
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0 no-scrollbar">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            className={`shrink-0 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
              category === cat.id
                ? 'bg-brand-dark text-white border-brand-dark'
                : 'bg-brand-surface text-brand-muted border-brand-border hover:border-brand-active hover:text-brand-dark'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Search + availability filter */}
      <div className="flex gap-2">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or location…"
          className="flex-1 min-w-0 text-sm border border-brand-border rounded-xl px-3 py-2.5 text-brand-dark placeholder:text-brand-muted focus:outline-none focus:ring-1 focus:ring-brand-active bg-brand-surface"
        />
        <div className="flex rounded-xl border border-brand-border bg-brand-surface overflow-hidden shrink-0">
          {(['all', 'open'] as const).map(opt => (
            <button
              key={opt}
              onClick={() => setRegFilter(opt)}
              className={`px-3 py-2 text-xs font-semibold transition-colors ${
                regFilter === opt ? 'bg-brand-dark text-white' : 'text-brand-muted hover:text-brand-dark'
              }`}
            >
              {opt === 'all' ? 'All' : 'Open only'}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {!hasResults ? (
        <div className="text-center py-16 space-y-3">
          <p className="text-3xl">🔍</p>
          <p className="text-sm font-semibold text-brand-dark">No results found</p>
          <p className="text-xs text-brand-muted">
            {hasActiveFilters
              ? 'Try adjusting your search or filters.'
              : 'Nothing in this category yet — check back soon.'}
          </p>
          {hasActiveFilters && (
            <button
              onClick={() => { setSearch(''); setRegFilter('all') }}
              className="mt-1 text-xs font-medium text-brand-active hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-8">

          {showOpenPlay && (
            <section className="space-y-3">
              {category === 'all' && (
                <h2 className="text-xs font-bold text-brand-muted uppercase tracking-widest">Open Play</h2>
              )}
              <div className="space-y-2">
                {filteredOpenPlay.map(e => <EventCard key={e.id} event={e} type="open_play" />)}
              </div>
            </section>
          )}

          {showLeagues && (
            <section className="space-y-3">
              {category === 'all' && (
                <h2 className="text-xs font-bold text-brand-muted uppercase tracking-widest">Leagues</h2>
              )}
              <div className="space-y-2">
                {filteredLeagues.map(l => <LeagueCard key={l.id} league={l} />)}
              </div>
            </section>
          )}

          {showTournaments && (
            <section className="space-y-3">
              {category === 'all' && (
                <h2 className="text-xs font-bold text-brand-muted uppercase tracking-widest">Tournaments</h2>
              )}
              <div className="space-y-2">
                {filteredTournaments.map(t => <TournamentCard key={t.id} tournament={t} />)}
              </div>
            </section>
          )}

          {showClinics && (
            <section className="space-y-3">
              {category === 'all' && (
                <h2 className="text-xs font-bold text-brand-muted uppercase tracking-widest">Clinics</h2>
              )}
              <div className="space-y-2">
                {filteredClinics.map(e => <EventCard key={e.id} event={e} type="clinic" />)}
              </div>
            </section>
          )}

          {showCourts && (
            <section className="space-y-3">
              {category === 'all' && (
                <h2 className="text-xs font-bold text-brand-muted uppercase tracking-widest">Courts &amp; Venues</h2>
              )}
              <div className="space-y-2">
                {filteredCourts.map(l => <CourtCard key={l.id} location={l} />)}
              </div>
            </section>
          )}

        </div>
      )}
    </div>
  )
}
