'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import SeedingPanel, { type MatchItem } from './SeedingPanel'
import BracketView from './BracketView'
import FixedPartnerAssignment from './FixedPartnerAssignment'
import PoolAssignment from './PoolAssignment'
import { isDoublesFormat, formatSkillRange } from '@/lib/taxonomy/formats'
import { formatSummaryLines } from './FormatSettingsFields'
import { computeStandings, type StandingsRow } from '@/lib/tournament/standings'
import { poolStandings, type PoolMatchInput } from '@/lib/tournament/poolPlayoffSeeding'
import { buildAutoSchedule } from '@/lib/tournament/autoSchedule'

function firstName(name: string | null | undefined): string {
  return name ? name.trim().split(/\s+/)[0] : ''
}

// One standings table (#, Team, W, L, PF, +/−). Reused for the combined view and for
// each pool's table in a pool-play division.
function StandingsTableBlock({ rows, teamName }: { rows: StandingsRow[]; teamName: (id: string) => string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-brand-border">
      <div className="grid grid-cols-[1.5rem_1fr_2rem_2rem_2rem_2.5rem] gap-x-1 px-3 py-2 text-[10px] font-semibold text-brand-muted uppercase tracking-wide border-b border-brand-border">
        <span>#</span><span>Team</span>
        <span className="text-center">W</span><span className="text-center">L</span>
        <span className="text-center">PF</span><span className="text-center">+/−</span>
      </div>
      {rows.map((row, i) => {
        const diff = row.pf - row.pa
        return (
          <div key={row.regId} className={`grid grid-cols-[1.5rem_1fr_2rem_2rem_2rem_2.5rem] gap-x-1 px-3 py-2 text-xs border-b border-brand-border last:border-0 ${i === 0 ? 'bg-brand-soft' : ''}`}>
            <span className="text-brand-muted font-medium">{i + 1}</span>
            <span className="font-semibold text-brand-dark truncate">{teamName(row.regId)}</span>
            <span className="text-center font-bold text-brand-dark">{row.wins}</span>
            <span className="text-center text-brand-dark">{row.losses}</span>
            <span className="text-center text-brand-muted">{row.pf}</span>
            <span className={`text-center font-bold tabular-nums ${diff >= 0 ? 'text-brand-active' : 'text-red-600'}`}>{diff >= 0 ? '+' : ''}{diff}</span>
          </div>
        )
      })}
    </div>
  )
}

type Registration = {
  id: string
  user_id: string
  partner_user_id: string | null
  partner_registration_id: string | null
  team_name: string | null
  status: string
  registration_type?: 'team' | 'solo'
  payment_status?: string | null
  stripe_payment_intent_id?: string | null
  seed?: number | null
  pool_number?: number | null
  user_profile: { name: string | null; is_stub?: boolean; dupr_rating?: number | null; estimated_rating?: number | null } | null
  partner_profile?: { name: string | null; dupr_rating?: number | null; estimated_rating?: number | null } | null
}

type Match = {
  id: string
  division_id: string
  round_number: number | null
  match_number: number
  match_stage: string
  pool_number: number | null
  court_number: number | null
  scheduled_time: string | null
  team_1_registration_id: string | null
  team_2_registration_id: string | null
  team_1_score: number | null
  team_2_score: number | null
  winner_registration_id: string | null
  status: string
}

type Division = {
  id: string
  name: string
  format: string
  category: string
  team_type: string
  partner_mode?: string
  skill_min: number | null
  skill_max: number | null
  max_entries: number
  waitlist_enabled: boolean
  status: string
  bracket_type: string
  format_settings_json: Record<string, unknown>
  cost_cents: number | null
}

type Props = {
  tournamentId: string
  tournamentName: string
  tournamentStartDate: string | null
  tournamentStartTime?: string | null
  division: Division
  initialRegistrations: Registration[]
  initialMatches: Match[]
  draftMatchCount?: number
  isOrganizer: boolean
  currentUserId: string | null
  locationCourtCount?: number | null
}
const FORMAT_LABELS: Record<string, string> = {
  mens_doubles: "Men's Doubles",
  womens_doubles: "Women's Doubles",
  mixed_doubles: 'Mixed Doubles',
  coed_doubles: 'Coed Doubles',
  open_doubles: 'Open Doubles',
  mens_singles: "Men's Singles",
  womens_singles: "Women's Singles",
  open_singles: 'Open Singles',
  individual_round_robin: 'Individual Round Robin',
  custom: 'Custom',
}

export default function DivisionManageView({
  tournamentId, tournamentName, tournamentStartDate, tournamentStartTime,
  division, initialRegistrations, initialMatches, draftMatchCount = 0,
  isOrganizer, currentUserId, locationCourtCount,
}: Props) {
  const router = useRouter()
  const [registrations, setRegistrations] = useState<Registration[]>(initialRegistrations)
  const [matches, setMatches] = useState<Match[]>(initialMatches)
  // Default false so the server and first client render agree (no hydration
  // mismatch); the stored preference is applied after mount.
  const [showSeeds, setShowSeeds] = useState<boolean>(false)
  useEffect(() => {
    try { setShowSeeds(localStorage.getItem(`seeds-${division.id}`) === 'true') } catch { /* */ }
  }, [division.id])

  function handleToggleShowSeeds(val: boolean) {
    setShowSeeds(val)
    try { localStorage.setItem(`seeds-${division.id}`, String(val)) } catch { /* */ }
  }

  // Add player state
  const [addingPlayer, setAddingPlayer] = useState(false)
  const [playerSearch, setPlayerSearch] = useState('')
  const [playerSearch2, setPlayerSearch2] = useState('')
  const [playerResults, setPlayerResults] = useState<{ id: string; name: string; dupr_rating?: number | null; estimated_rating?: number | null }[]>([])
  const [playerResults2, setPlayerResults2] = useState<{ id: string; name: string; dupr_rating?: number | null; estimated_rating?: number | null }[]>([])
  const [selectedP1, setSelectedP1] = useState<{ id: string; name: string; dupr_rating?: number | null; estimated_rating?: number | null } | null>(null)
  const [addTeamName, setAddTeamName] = useState('')
  const [addPlayerLoading, setAddPlayerLoading] = useState(false)
  const [addPlayerError, setAddPlayerError] = useState<string | null>(null)
  const [playoffLoading, setPlayoffLoading] = useState(false)
  const [playoffError, setPlayoffError] = useState<string | null>(null)
  const [showPlayoffPrompt, setShowPlayoffPrompt] = useState(false)

  const isDoubles = isDoublesFormat(division.format)
  const isBracket = division.bracket_type === 'single_elimination' || division.bracket_type === 'double_elimination'
  const hasMatches = matches.length > 0
  const active = registrations.filter(r => r.status !== 'cancelled')

  // Optional playoff stage for round-robin AND pool-play divisions: generated once
  // the base play (round robin, or the pools) is fully scored, and only once.
  const hasPlayoffMatches = matches.some(m =>
    ['playoffs', 'single_elimination', 'winners_bracket', 'losers_bracket', 'championship'].includes(m.match_stage))
  // The "base play" stage whose results seed the playoff bracket.
  const playoffBaseStage = division.bracket_type === 'round_robin' ? 'round_robin'
    : division.bracket_type === 'pool_play_playoffs' ? 'pool_play' : null
  const basePlayDone = (() => {
    if (!playoffBaseStage) return false
    const base = matches.filter(m => m.match_stage === playoffBaseStage)
    return base.length > 0 && base.every(m => m.status === 'completed')
  })()
  // Round robin gates on the explicit playoffs_enabled toggle (matching the route);
  // a "Pool Play + Playoffs" division always implies a playoff stage.
  const playoffsConfigured = division.bracket_type === 'round_robin'
    ? !!(division.format_settings_json as any)?.playoffs_enabled
    : division.bracket_type === 'pool_play_playoffs'
  const canGeneratePlayoffs = isOrganizer && playoffsConfigured && basePlayDone && !hasPlayoffMatches

  // Pop the "generate playoffs?" prompt the moment the final base match is scored
  // this session (false→true transition). `basePlayDone` already true on mount means
  // the page was opened after the fact — no auto-prompt then (the card still shows).
  const basePlayWasDone = useRef(basePlayDone)
  useEffect(() => {
    if (canGeneratePlayoffs && !basePlayWasDone.current) setShowPlayoffPrompt(true)
    basePlayWasDone.current = basePlayDone
  }, [canGeneratePlayoffs, basePlayDone])
  // Dismiss the prompt once playoffs exist (generated from the prompt or the card).
  useEffect(() => {
    if (hasPlayoffMatches) setShowPlayoffPrompt(false)
  }, [hasPlayoffMatches])

  // Bracket ⇄ Standings toggle for this division's match section.
  const [matchView, setMatchView] = useState<'bracket' | 'standings'>('bracket')
  const teamName = useCallback((regId: string) => {
    const r = active.find(x => x.id === regId)
    if (!r) return '—'
    const a = firstName(r.user_profile?.name)
    if (r.partner_registration_id) {
      const p = active.find(x => x.id === r.partner_registration_id)
      const b = firstName(p?.user_profile?.name)
      if (a && b) return [a, b].sort((m, n) => m.localeCompare(n)).join('/')
    }
    return a || r.team_name || regId.slice(0, 8)
  }, [active])
  // For round-robin and pool-play divisions, standings reflect the base play only
  // (the seeding source for playoffs) — playoff bracket results never re-rank them.
  const standingsMatches = useMemo(() => {
    if (division.bracket_type === 'round_robin') return matches.filter(m => m.match_stage === 'round_robin')
    if (division.bracket_type === 'pool_play_playoffs') return matches.filter(m => m.match_stage === 'pool_play')
    return matches
  }, [matches, division.bracket_type])
  // teamName feeds the alphabetical tiebreaker so pre-play standings (all 0–0) sort by name.
  const standings = useMemo(() => computeStandings(standingsMatches, active, teamName), [standingsMatches, active, teamName])
  // Pool-play divisions show one table PER POOL — a combined table makes two separate
  // pool winners look like a head-to-head tie. null for every other format.
  const poolStandingsRows = useMemo(
    () => division.bracket_type === 'pool_play_playoffs'
      ? poolStandings(matches.filter(m => m.match_stage === 'pool_play') as PoolMatchInput[], active, teamName)
      : null,
    [matches, division.bracket_type, active, teamName],
  )
  const maxPlayers = isDoubles ? division.max_entries * 2 : division.max_entries
  const isFull = active.length >= maxPlayers

  const matchItems: MatchItem[] = matches.map(m => ({
    id: m.id,
    round_number: m.round_number ?? 1,
    match_number: m.match_number,
    team_1_registration_id: m.team_1_registration_id,
    team_2_registration_id: m.team_2_registration_id,
    court_number: m.court_number,
    scheduled_time: m.scheduled_time,
    status: m.status,
  }))

  const summaryLines = formatSummaryLines(division.bracket_type as any, division.format_settings_json as any, isDoubles, division.max_entries)

  // ── Schedule staleness ──────────────────────────────────────────────────────
  // Matches are a snapshot from generation time. A player who cancels afterward
  // lingers as a "—" slot; players who register later aren't added. Flag both so
  // the organizer knows to re-generate. Eligibility mirrors generate-matches
  // (status 'registered' + paid/waived/comped) so we don't false-flag waitlisted
  // or unpaid players who legitimately wouldn't be scheduled anyway.
  const scheduleStale = (() => {
    if (!hasMatches) return null
    const scheduled = new Set<string>()
    for (const m of matches) {
      if (m.team_1_registration_id) scheduled.add(m.team_1_registration_id)
      if (m.team_2_registration_id) scheduled.add(m.team_2_registration_id)
    }
    const eligible = registrations.filter(
      r => r.status === 'registered' && ['paid', 'waived', 'comped'].includes(r.payment_status ?? ''),
    )
    const eligibleIds = new Set(eligible.map(r => r.id))
    // In the schedule but no longer an eligible entrant (cancelled / withdrawn) → "—".
    const removed = [...scheduled].filter(id => !eligibleIds.has(id)).length
    // Eligible but absent from every match (registered after generation). Count each
    // doubles team once — a reg is "covered" if it or its partner is scheduled.
    const counted = new Set<string>()
    let added = 0
    for (const r of eligible) {
      if (scheduled.has(r.id) || (r.partner_registration_id && scheduled.has(r.partner_registration_id))) continue
      if (counted.has(r.id)) continue
      counted.add(r.id)
      if (r.partner_registration_id) counted.add(r.partner_registration_id)
      added++
    }
    return removed > 0 || added > 0 ? { removed, added } : null
  })()

  async function handleGenerateMatches(durationMinutes: number, confirmDiscard = false) {
    const res = await fetch(
      `/api/tournaments/${tournamentId}/divisions/${division.id}/generate-matches`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: hasMatches, confirmDiscardScores: confirmDiscard }),
      }
    )
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      // Re-generating over a bracket that already has scored matches needs explicit
      // confirmation — the server blocks it until confirmDiscardScores is set.
      if (d.error === 'has_completed_matches' && !confirmDiscard) {
        if (typeof window !== 'undefined' && window.confirm(`${d.message}\n\nDelete them and re-generate?`)) {
          return handleGenerateMatches(durationMinutes, true)
        }
        return
      }
      throw new Error(d.message ?? d.error ?? 'Failed to generate matches')
    }
    const { matches: newMatches } = await res.json()

    let scheduledMatches: Match[] = newMatches ?? []

    // Auto-schedule: distribute matches across courts, stagger by round
    if (newMatches?.length && tournamentStartDate) {
      const startTime = tournamentStartTime?.slice(0, 5) ?? '09:00'
      const courts = Math.max(1, locationCourtCount ?? 1)

      // Gather (court, time) cells already booked by OTHER divisions so we don't
      // double-book a court — the scheduler skips any cell in here.
      const { data: bookedRaw } = await createClient()
        .from('tournament_matches')
        .select('court_number, scheduled_time')
        .eq('tournament_id', tournamentId)
        .neq('division_id', division.id)
        .eq('is_draft', false)
        .not('court_number', 'is', null)
        .not('scheduled_time', 'is', null)
      const occupied = (bookedRaw ?? [])
        .map(b => ({ court_number: b.court_number as number, start_ms: Date.parse(b.scheduled_time as string) }))
        .filter(b => !Number.isNaN(b.start_ms))

      const updates = buildAutoSchedule(newMatches, tournamentStartDate, startTime, courts, durationMinutes, occupied)
      await fetch(`/api/tournaments/${tournamentId}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })

      // Apply schedule assignments locally so the UI updates immediately
      const updateMap = new Map(updates.map(u => [u.id, u]))
      scheduledMatches = (newMatches as Match[]).map(m => {
        const u = updateMap.get(m.id)
        return u ? { ...m, court_number: u.court_number, scheduled_time: u.scheduled_time } : m
      })
    }

    setMatches(scheduledMatches)
    router.refresh()
  }

  async function handleGeneratePlayoffs() {
    setPlayoffLoading(true); setPlayoffError(null)
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/divisions/${division.id}/generate-playoffs`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setPlayoffError(json.error ?? 'Failed to generate playoffs'); return }
      const newMatches: Match[] = json.matches ?? []

      let scheduled = newMatches
      if (newMatches.length && tournamentStartDate) {
        const startTime = tournamentStartTime?.slice(0, 5) ?? '09:00'
        const courts = Math.max(1, locationCourtCount ?? 1)
        // Occupancy = every booked match in the tournament (incl. this division's
        // round robin) so playoff matches slot onto free courts after it.
        const { data: bookedRaw } = await createClient()
          .from('tournament_matches')
          .select('court_number, scheduled_time')
          .eq('tournament_id', tournamentId)
          .eq('is_draft', false)
          .not('court_number', 'is', null)
          .not('scheduled_time', 'is', null)
        const occupied = (bookedRaw ?? [])
          .map(b => ({ court_number: b.court_number as number, start_ms: Date.parse(b.scheduled_time as string) }))
          .filter(b => !Number.isNaN(b.start_ms))
        const updates = buildAutoSchedule(newMatches, tournamentStartDate, startTime, courts, 60, occupied)
        await fetch(`/api/tournaments/${tournamentId}/schedule`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates }),
        })
        const updateMap = new Map(updates.map(u => [u.id, u]))
        scheduled = newMatches.map(m => {
          const u = updateMap.get(m.id)
          return u ? { ...m, court_number: u.court_number, scheduled_time: u.scheduled_time } : m
        })
      }
      setMatches(prev => [...prev, ...scheduled])
      router.refresh()
    } catch (e) {
      setPlayoffError(e instanceof Error ? e.message : 'Failed to generate playoffs')
    } finally {
      setPlayoffLoading(false)
    }
  }

  function handleScoreUpdate(updatedMatches: Match[]) {
    setMatches(prev => {
      const next = prev.map(m => {
        const u = updatedMatches.find(x => x.id === m.id)
        return u ? { ...m, ...u } : m
      })
      // Append matches the score created server-side that we don't have yet —
      // notably the double-elim bracket-reset decider, inserted when the losers-
      // bracket champion wins the first championship. Without this the reset is
      // dropped and the bracket looks finished a round early.
      const known = new Set(prev.map(m => m.id))
      for (const u of updatedMatches) if (!known.has(u.id)) next.push(u as Match)
      return next
    })
  }

  async function handleMarkComped(regId: string) {
    const supabase = createClient()
    const { error } = await supabase.from('tournament_registrations').update({ payment_status: 'comped' }).eq('id', regId)
    if (error) { alert(error.message); return }
    setRegistrations(prev => prev.map(r => r.id === regId ? { ...r, payment_status: 'comped' } : r))
  }

  async function handleRemove(regId: string) {
    const res = await fetch(`/api/tournaments/${tournamentId}/registrations/${regId}/cancel`, { method: 'POST' })
    if (!res.ok) { alert('Could not remove — please try again'); return }
    setRegistrations(prev => prev.map(r => r.id === regId ? { ...r, status: 'cancelled' } : r))
  }

  // Fixed-partner save: relink both rows and clear any displaced back-links so
  // the local roster matches what the assign-partner route wrote server-side.
  function handlePartnerAssigned(reg1Id: string, reg2Id: string | null) {
    setRegistrations(prev => {
      const reg1 = prev.find(r => r.id === reg1Id)
      const reg2 = reg2Id ? prev.find(r => r.id === reg2Id) : null
      return prev.map(r => {
        if (r.id === reg1Id) return { ...r, partner_registration_id: reg2Id, partner_user_id: reg2?.user_id ?? null }
        if (reg2Id && r.id === reg2Id) return { ...r, partner_registration_id: reg1Id, partner_user_id: reg1?.user_id ?? null }
        if (r.partner_registration_id === reg1Id) return { ...r, partner_registration_id: null, partner_user_id: null }
        if (reg2Id && r.partner_registration_id === reg2Id) return { ...r, partner_registration_id: null, partner_user_id: null }
        return r
      })
    })
  }

  function handleReplacePlayer(regId: string, newUserId: string, newUserName: string) {
    setRegistrations(prev => prev.map(r =>
      r.id === regId
        ? { ...r, user_id: newUserId, user_profile: { ...r.user_profile, name: newUserName, is_stub: false } }
        : r
    ))
  }

  // Pool assignment save: mirror pool_number onto the team's registration(s) so
  // the panel reflects the change without a refetch (both partners for doubles).
  function handlePoolAssigned(regId: string, partnerId: string | null, poolNumber: number | null) {
    const ids = new Set([regId, ...(partnerId ? [partnerId] : [])])
    setRegistrations(prev => prev.map(r => ids.has(r.id) ? { ...r, pool_number: poolNumber } : r))
  }

  async function searchPlayers(
    query: string,
    excludeIds: string[] = [],
    setSearch: (v: string) => void = setPlayerSearch,
    setResults: (v: { id: string; name: string; dupr_rating?: number | null; estimated_rating?: number | null }[]) => void = setPlayerResults,
  ) {
    setSearch(query)
    const supabase = createClient()
    let q = supabase.from('profiles').select('id, name, dupr_rating, estimated_rating').order('name').limit(500)
    if (query.trim()) q = (q as any).ilike('name', `%${query}%`)
    const skip = Array.from(new Set((currentUserId ? [currentUserId] : []).concat(excludeIds)))
    if (skip.length > 0) q = q.not('id', 'in', `(${skip.join(',')})`)
    if (division.format === 'mens_doubles' || division.format === 'mens_singles') q = (q as any).eq('gender', 'male')
    else if (division.format === 'womens_doubles' || division.format === 'womens_singles') q = (q as any).eq('gender', 'female')
    const { data } = await q
    setResults(data ?? [])
  }

  async function handleAddPlayer(player: { id: string; name: string; dupr_rating?: number | null; estimated_rating?: number | null }) {
    setAddPlayerLoading(true); setAddPlayerError(null)
    const res = await fetch(
      `/api/tournaments/${tournamentId}/divisions/${division.id}/register`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: player.id }) }
    )
    const json = await res.json()
    if (!res.ok) { setAddPlayerError(json.error ?? 'Failed to add player'); setAddPlayerLoading(false); return }
    setRegistrations(prev => [...prev, { ...json.registration, user_profile: { name: player.name, dupr_rating: player.dupr_rating ?? null, estimated_rating: player.estimated_rating ?? null } }])
    setAddingPlayer(false); setPlayerSearch(''); setPlayerResults([])
    setAddPlayerLoading(false)
  }

  async function handleAddTeam(
    p1: { id: string; name: string; dupr_rating?: number | null; estimated_rating?: number | null },
    p2: { id: string; name: string; dupr_rating?: number | null; estimated_rating?: number | null },
    teamName: string,
  ) {
    setAddPlayerLoading(true); setAddPlayerError(null)
    const res = await fetch(
      `/api/tournaments/${tournamentId}/divisions/${division.id}/register`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: p1.id, partner_user_id: p2.id, team_name: teamName || null }) }
    )
    const json = await res.json()
    if (!res.ok) { setAddPlayerError(json.error ?? 'Failed to add team'); setAddPlayerLoading(false); return }
    const reg1 = {
      ...json.reg1,
      user_profile: { name: p1.name, dupr_rating: p1.dupr_rating ?? null, estimated_rating: p1.estimated_rating ?? null },
      partner_profile: { name: p2.name, dupr_rating: p2.dupr_rating ?? null, estimated_rating: p2.estimated_rating ?? null },
    }
    const reg2 = {
      ...json.reg2,
      user_profile: { name: p2.name, dupr_rating: p2.dupr_rating ?? null, estimated_rating: p2.estimated_rating ?? null },
      partner_profile: { name: p1.name, dupr_rating: p1.dupr_rating ?? null, estimated_rating: p1.estimated_rating ?? null },
    }
    setRegistrations(prev => [...prev, reg1, reg2])
    setAddingPlayer(false); setSelectedP1(null)
    setPlayerSearch(''); setPlayerSearch2(''); setPlayerResults([]); setPlayerResults2([])
    setAddTeamName(''); setAddPlayerLoading(false)
  }

  const existingUserIds = active.map(r => r.user_id)

  const addPlayerContent = isOrganizer && !isFull ? (
    <div className="space-y-2">
      {addingPlayer ? (
        <>
          <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">
            {isDoubles ? 'Add Team' : 'Add Player'}
          </p>
          {isDoubles ? (
            selectedP1 ? (
              <>
                <div className="flex items-center gap-2 px-3 py-2 bg-brand-soft rounded-lg text-xs">
                  <span className="font-medium text-brand-dark flex-1">{selectedP1.name}</span>
                  <button onClick={() => { setSelectedP1(null); setPlayerSearch(''); setPlayerResults([]); setPlayerSearch2(''); setPlayerResults2([]) }} className="text-brand-muted hover:text-red-500">✕</button>
                </div>
                <input type="text" value={playerSearch2} onChange={e => searchPlayers(e.target.value, [...existingUserIds, selectedP1.id], setPlayerSearch2, setPlayerResults2)} onFocus={() => searchPlayers(playerSearch2, [...existingUserIds, selectedP1.id], setPlayerSearch2, setPlayerResults2)} placeholder="Search partner by name…" className="w-full input text-xs" autoFocus />
                {playerResults2.length > 0 && (<ul className="border border-brand-border rounded-xl overflow-y-auto max-h-48">{playerResults2.map(p => (<li key={p.id}><button onClick={() => handleAddTeam(selectedP1, p, addTeamName)} disabled={addPlayerLoading} className="w-full text-left px-3 py-2 text-xs text-brand-dark hover:bg-brand-soft">{p.name}</button></li>))}</ul>)}
                <input type="text" value={addTeamName} onChange={e => setAddTeamName(e.target.value)} placeholder="Team name (optional)" className="w-full input text-xs" />
              </>
            ) : (
              <>
                <input type="text" value={playerSearch} onChange={e => searchPlayers(e.target.value, existingUserIds)} onFocus={() => searchPlayers(playerSearch, existingUserIds)} placeholder="Search player 1 by name…" className="w-full input text-xs" autoFocus />
                {playerResults.length > 0 && (<ul className="border border-brand-border rounded-xl overflow-y-auto max-h-64">{playerResults.map(p => (<li key={p.id}><button onClick={() => { setSelectedP1(p); setPlayerSearch(''); setPlayerResults([]) }} className="w-full text-left px-3 py-2 text-xs text-brand-dark hover:bg-brand-soft">{p.name}</button></li>))}</ul>)}
              </>
            )
          ) : (
            <>
              <input type="text" value={playerSearch} onChange={e => searchPlayers(e.target.value, existingUserIds)} onFocus={() => searchPlayers(playerSearch, existingUserIds)} placeholder="Search player by name…" className="w-full input text-xs" autoFocus />
              {playerResults.length > 0 && (<ul className="border border-brand-border rounded-xl overflow-y-auto max-h-64">{playerResults.map(p => (<li key={p.id}><button onClick={() => handleAddPlayer(p)} disabled={addPlayerLoading} className="w-full text-left px-3 py-2 text-xs text-brand-dark hover:bg-brand-soft">{p.name}</button></li>))}</ul>)}
            </>
          )}
          {addPlayerError && <p className="text-xs text-red-600">{addPlayerError}</p>}
          <button onClick={() => { setAddingPlayer(false); setSelectedP1(null); setPlayerSearch(''); setPlayerSearch2(''); setPlayerResults([]); setPlayerResults2([]); setAddTeamName(''); setAddPlayerError(null) }} className="text-xs text-brand-muted hover:underline">Cancel</button>
        </>
      ) : (
        <button onClick={() => { setAddingPlayer(true); searchPlayers('', existingUserIds) }} className="text-xs text-brand-active font-medium hover:underline">
          {isDoubles ? '+ Add Team' : '+ Add Player'}
        </button>
      )}
    </div>
  ) : null

  // Bracket/standings view. For organizers it is injected into the Seeding panel
  // (between the roster and the schedule tools); non-organizers get it standalone below.
  const matchViewContent = hasMatches ? (
    <div id="scores" className="scroll-mt-20 bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        {/* Bracket ⇄ Standings toggle */}
        <div className="flex items-center gap-1 bg-white rounded-full border border-brand-border p-0.5">
          {([['bracket', isBracket ? 'Bracket' : 'Matches'], ['standings', 'Standings']] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setMatchView(v)}
              className={`text-[11px] font-semibold px-3 py-1 rounded-full transition-colors ${
                matchView === v ? 'bg-brand text-brand-dark' : 'text-brand-muted hover:text-brand-dark'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {isOrganizer && matchView === 'bracket' && (
          <p className="text-[11px] text-brand-muted">Tap “Score” on any match to enter the result</p>
        )}
      </div>

      {matchView === 'standings' ? (
        poolStandingsRows ? (
          // One table per pool, so two separate pool winners never look like a tie.
          <div className="space-y-3">
            {poolStandingsRows.map(({ pool, rows }) => (
              <div key={pool} className="space-y-1">
                <p className="text-[11px] font-bold uppercase tracking-widest text-brand-dark">Pool {pool}</p>
                <StandingsTableBlock rows={rows} teamName={teamName} />
              </div>
            ))}
            <p className="text-[10px] text-brand-muted">Each pool is ranked on its own — the top finishers from every pool advance to the playoffs.</p>
          </div>
        ) : (
          <StandingsTableBlock rows={standings} teamName={teamName} />
        )
      ) : (
        <BracketView
          matches={matches}
          regs={active.map(r => ({
            id: r.id,
            user_id: r.user_id,
            team_name: r.team_name,
            status: r.status,
            seed: r.seed ?? null,
            user_profile: r.user_profile ? { name: r.user_profile.name ?? '' } : null,
            partner_user_id: r.partner_user_id,
            partner_profile: r.partner_profile ? { name: r.partner_profile.name ?? '' } : null,
          }))}
          isOrganizer={isOrganizer}
          isDoubles={isDoubles}
          tournamentId={tournamentId}
          divisionId={division.id}
          onScoreUpdate={handleScoreUpdate}
          listLayout={!isBracket}
          pointsToWin={(division.format_settings_json as any)?.games_to ?? 11}
          showSeeds={showSeeds}
        />
      )}
    </div>
  ) : null

  // "Generate Playoffs" CTA — rendered directly below the match/bracket view (inside
  // the seeding panel's bracketSlot) so it's right there the moment scoring finishes.
  const generatePlayoffsCard = canGeneratePlayoffs ? (
    <div className="bg-brand-soft border-2 border-brand rounded-2xl p-4 space-y-2">
      <p className="text-sm font-semibold text-brand-dark">
        {division.bracket_type === 'pool_play_playoffs' ? '🏆 Pools complete' : '🏆 Round robin complete'}
      </p>
      <p className="text-xs text-brand-muted leading-relaxed">
        {division.bracket_type === 'pool_play_playoffs'
          ? `Seed the top ${(division.format_settings_json as any)?.teams_advance_per_pool ?? 2} from each pool into a${(division.format_settings_json as any)?.playoff_format === 'double_elimination' ? ' double' : ' single'}-elimination bracket.`
          : `Seed the top ${(division.format_settings_json as any)?.playoff_qualifiers ?? 2} finishers into a${(division.format_settings_json as any)?.playoff_format === 'double_elimination' ? ' single-elim bracket with a double-elim final' : ' single-elimination bracket'} from the current standings.`}
      </p>
      <button
        onClick={handleGeneratePlayoffs}
        disabled={playoffLoading}
        className="w-full py-2.5 rounded-xl bg-brand-dark text-white text-sm font-semibold hover:bg-brand-dark/90 disabled:opacity-50 transition-colors"
      >
        {playoffLoading ? 'Generating…' : 'Generate Playoffs →'}
      </button>
      {playoffError && <p className="text-xs text-red-600">{playoffError}</p>}
    </div>
  ) : null

  return (
    <div className="min-h-screen bg-brand-bg">
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">

        {/* ── Back + header ── */}
        <div>
          <Link href={`/tournaments/${tournamentId}`} className="text-sm text-brand-muted hover:text-brand-dark">
            ← {tournamentName}
          </Link>
        </div>

        <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="font-heading text-lg font-bold text-brand-dark">{division.name}</h1>
              <p className="text-xs text-brand-muted mt-0.5">
                {FORMAT_LABELS[division.format] ?? division.format}
                {formatSkillRange(division.skill_min, division.skill_max) && ` · ${formatSkillRange(division.skill_min, division.skill_max)}`}
              </p>
              <p className="text-xs text-brand-muted">{summaryLines.join(' · ')}</p>
            </div>
            <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${
              division.status === 'closed'             ? 'bg-gray-100 text-gray-500'    :
              isFull && !division.waitlist_enabled     ? 'bg-red-100 text-red-700'      :
                                                        'bg-brand-soft text-brand-active'
            }`}>
              {division.status === 'closed' ? 'Closed' : isFull && !division.waitlist_enabled ? 'Full' : 'Open'}
            </span>
          </div>
          <p className="text-xs text-brand-muted">
            <span className="font-semibold text-brand-dark">
              {isDoubles ? Math.floor(active.length / 2) : active.length}
            </span>
            {' / '}{division.max_entries}{' '}{isDoubles ? 'teams' : 'players'}
          </p>
        </div>

        {/* ── Draft schedule notice ── */}
        {isOrganizer && draftMatchCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-2">
            <p className="text-sm font-semibold text-amber-900">
              This division has an unpublished draft schedule
            </p>
            <p className="text-xs text-amber-800 leading-relaxed">
              {draftMatchCount} draft match{draftMatchCount === 1 ? '' : 'es'} {matches.length === 0 ? 'were' : 'are also'} generated from the Schedule Builder. Draft matches stay hidden here (and from players) until you publish them — which is why
              {matches.length === 0 ? ' this page looks empty and ' : ' '}
              re-generating is blocked. Publish the draft to go live, or discard it to generate here instead.
            </p>
            <Link
              href={`/tournaments/${tournamentId}/schedule/builder`}
              className="inline-block mt-1 py-2 px-4 rounded-xl bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors"
            >
              Open Schedule Builder →
            </Link>
          </div>
        )}

        {/* ── Stale-schedule warning: roster changed since matches were generated ── */}
        {isOrganizer && scheduleStale && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <p className="font-semibold">This schedule is out of date.</p>
            <ul className="mt-1 list-disc list-inside space-y-0.5">
              {scheduleStale.removed > 0 && (
                <li>
                  {scheduleStale.removed} scheduled {scheduleStale.removed === 1 ? 'player is' : 'players are'} no
                  longer registered — {scheduleStale.removed === 1 ? 'it shows' : 'they show'} as “—” in the matches below.
                </li>
              )}
              {scheduleStale.added > 0 && (
                <li>
                  {scheduleStale.added} newly-registered {scheduleStale.added === 1 ? 'player is' : 'players are'} not
                  in the schedule.
                </li>
              )}
            </ul>
            <p className="mt-1">Re-generate the matches to rebuild for the current field.</p>
          </div>
        )}

        {/* ── Fixed-partner assignment — organizer, fixed-mode doubles, pre-bracket.
              Hidden once matches exist: partners are locked in by then. ── */}
        {isOrganizer && isDoubles && division.partner_mode === 'fixed' && !hasMatches && (
          <FixedPartnerAssignment
            tournamentId={tournamentId}
            divisionId={division.id}
            registrations={active}
            onAssigned={handlePartnerAssigned}
          />
        )}

        {/* ── Pool assignment — organizer, pool-play division, pre-generation.
              Optional: unassigned teams auto-balance by seed when matches generate. ── */}
        {isOrganizer && division.bracket_type === 'pool_play_playoffs' && !hasMatches && (
          <PoolAssignment
            tournamentId={tournamentId}
            divisionId={division.id}
            numPools={(division.format_settings_json as any)?.number_of_pools ?? 2}
            registrations={active}
            onAssigned={handlePoolAssigned}
          />
        )}

        {/* ── Seeding, schedule, match generation — all divisions. The Generate
              Playoffs CTA rides in the bracketSlot, directly below the match view,
              so it lands right where scoring ends. ── */}
        {isOrganizer && (
          <SeedingPanel
            registrations={active}
            isDoubles={isDoubles}
            tournamentId={tournamentId}
            divisionId={division.id}
            onMarkComped={handleMarkComped}
            onRemove={handleRemove}
            hasMatches={hasMatches}
            onGenerateMatches={handleGenerateMatches}
            onReplacePlayer={handleReplacePlayer}
            matches={matchItems}
            isElimination={isBracket}
            tournamentDate={tournamentStartDate ?? undefined}
            addPlayerSlot={addPlayerContent}
            bracketSlot={<>{matchViewContent}{generatePlayoffsCard}</>}
            showSeeds={showSeeds}
            onToggleShowSeeds={handleToggleShowSeeds}
          />
        )}

        {/* ── Bracket / Standings — standalone for non-organizers; organizers see it inside the Seeding panel ── */}
        {!isOrganizer && matchViewContent}

        {/* ── Non-organizer registrant list ── */}
        {!isOrganizer && (
          <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
            <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">Registrants</p>
            {active.length === 0 ? (
              <p className="text-xs text-brand-muted">No registrants yet.</p>
            ) : (
              <ul className="divide-y divide-brand-border/60">
                {active.map((r, i) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                    <span className="text-brand-muted w-5 shrink-0">{i + 1}</span>
                    <span className="flex-1 font-medium text-brand-dark truncate">{r.user_profile?.name ?? '—'}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      r.payment_status === 'paid'   ? 'bg-green-100 text-green-700' :
                      r.payment_status === 'comped' ? 'bg-blue-50 text-blue-600'   :
                      r.payment_status === 'waived' ? 'bg-gray-100 text-gray-500'  :
                      r.payment_status == null      ? 'bg-brand-soft text-brand-active' :
                                                      'bg-red-50 text-red-600'
                    }`}>
                      {r.payment_status ?? 'Free'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── Playoffs-ready prompt — pops when the final base match is scored ── */}
        {showPlayoffPrompt && canGeneratePlayoffs && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowPlayoffPrompt(false) }}
          >
            <div className="w-full sm:max-w-sm bg-white rounded-2xl p-6 space-y-4">
              <h2 className="font-heading text-base font-bold text-brand-dark">
                🏆 {division.bracket_type === 'pool_play_playoffs' ? 'All pools complete!' : 'Round robin complete!'}
              </h2>
              <p className="text-sm text-brand-muted">
                {division.bracket_type === 'pool_play_playoffs'
                  ? `Every pool match is scored. Generate the playoff bracket now? The top ${(division.format_settings_json as any)?.teams_advance_per_pool ?? 2} from each pool will be seeded automatically.`
                  : `Every match is scored. Generate the playoff bracket now? The top ${(division.format_settings_json as any)?.playoff_qualifiers ?? 2} finishers will be seeded automatically.`}
              </p>
              {playoffError && <p className="text-sm text-red-600">{playoffError}</p>}
              <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
                <button
                  onClick={() => setShowPlayoffPrompt(false)}
                  disabled={playoffLoading}
                  className="flex-1 py-2.5 rounded-xl border border-brand-border text-brand-dark text-sm font-semibold hover:border-brand-active transition-colors disabled:opacity-50"
                >
                  Later
                </button>
                <button
                  onClick={handleGeneratePlayoffs}
                  disabled={playoffLoading}
                  className="flex-1 py-2.5 rounded-xl bg-brand-dark text-white text-sm font-semibold hover:bg-brand-dark/90 transition-colors disabled:opacity-50"
                >
                  {playoffLoading ? 'Generating…' : 'Generate Playoffs →'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
