'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import SeedingPanel, { type MatchItem } from './SeedingPanel'
import BracketView from './BracketView'
import { isDoublesFormat, formatSkillRange } from '@/lib/taxonomy/formats'
import { formatSummaryLines } from './FormatSettingsFields'

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
  isOrganizer: boolean
  currentUserId: string | null
  locationCourtCount?: number | null
}

function buildAutoSchedule(
  matches: Match[],
  startDate: string,
  startTime: string,           // "HH:MM"
  courtCount: number,
  durationMinutes: number,
): Array<{ id: string; court_number: number; scheduled_time: string }> {
  const byRound = new Map<number, Match[]>()
  for (const m of matches) {
    const r = m.round_number ?? 1
    if (!byRound.has(r)) byRound.set(r, [])
    byRound.get(r)!.push(m)
  }
  const rounds = Array.from(byRound.entries())
    .sort(([a], [b]) => a - b)
    .map(([, ms]) => ms.sort((a, b) => a.match_number - b.match_number))

  const [h, min] = startTime.split(':').map(Number)
  let offsetMin = h * 60 + (min || 0)
  const result: Array<{ id: string; court_number: number; scheduled_time: string }> = []

  for (const roundMatches of rounds) {
    for (let i = 0; i < roundMatches.length; i++) {
      const slotOffset = Math.floor(i / courtCount)
      const courtOffset = i % courtCount
      const totalMin = offsetMin + slotOffset * durationMinutes
      const hh = String(Math.floor(totalMin / 60)).padStart(2, '0')
      const mm = String(totalMin % 60).padStart(2, '0')
      result.push({
        id: roundMatches[i].id,
        court_number: courtOffset + 1,
        scheduled_time: `${startDate}T${hh}:${mm}:00-07:00`,
      })
    }
    const slotsNeeded = Math.ceil(roundMatches.length / courtCount)
    offsetMin += slotsNeeded * durationMinutes
  }
  return result
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
  division, initialRegistrations, initialMatches,
  isOrganizer, currentUserId, locationCourtCount,
}: Props) {
  const router = useRouter()
  const [registrations, setRegistrations] = useState<Registration[]>(initialRegistrations)
  const [matches, setMatches] = useState<Match[]>(initialMatches)

  // Add player state
  const [addingPlayer, setAddingPlayer] = useState(false)
  const [playerSearch, setPlayerSearch] = useState('')
  const [playerSearch2, setPlayerSearch2] = useState('')
  const [playerResults, setPlayerResults] = useState<{ id: string; name: string }[]>([])
  const [playerResults2, setPlayerResults2] = useState<{ id: string; name: string }[]>([])
  const [selectedP1, setSelectedP1] = useState<{ id: string; name: string } | null>(null)
  const [addTeamName, setAddTeamName] = useState('')
  const [addPlayerLoading, setAddPlayerLoading] = useState(false)
  const [addPlayerError, setAddPlayerError] = useState<string | null>(null)

  const isDoubles = isDoublesFormat(division.format)
  const isBracket = division.bracket_type === 'single_elimination' || division.bracket_type === 'double_elimination'
  const hasMatches = matches.length > 0
  const active = registrations.filter(r => r.status !== 'cancelled')
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

  const summaryLines = formatSummaryLines(division.bracket_type as any, division.format_settings_json as any)

  async function handleGenerateMatches() {
    const res = await fetch(
      `/api/tournaments/${tournamentId}/divisions/${division.id}/generate-matches`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: hasMatches }) }
    )
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error ?? 'Failed to generate matches')
    }
    const { matches: newMatches } = await res.json()

    // Auto-schedule: distribute matches across courts, stagger by round
    if (newMatches?.length && tournamentStartDate) {
      const startTime = tournamentStartTime?.slice(0, 5) ?? '09:00'
      const courts = Math.max(1, locationCourtCount ?? 1)
      const gamesToPoints = (division.format_settings_json as any)?.games_to ?? 11
      const duration = gamesToPoints >= 21 ? 45 : gamesToPoints >= 15 ? 35 : 25

      const updates = buildAutoSchedule(newMatches, tournamentStartDate, startTime, courts, duration)
      await fetch(`/api/tournaments/${tournamentId}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })
    }

    router.refresh()
  }

  function handleScoreUpdate(updatedMatches: Match[]) {
    setMatches(prev => prev.map(m => {
      const u = updatedMatches.find(x => x.id === m.id)
      return u ? { ...m, ...u } : m
    }))
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

  function handleReplacePlayer(regId: string, newUserId: string, newUserName: string) {
    setRegistrations(prev => prev.map(r =>
      r.id === regId
        ? { ...r, user_id: newUserId, user_profile: { ...r.user_profile, name: newUserName, is_stub: false } }
        : r
    ))
  }

  async function searchPlayers(
    query: string,
    excludeIds: string[] = [],
    setSearch: (v: string) => void = setPlayerSearch,
    setResults: (v: { id: string; name: string }[]) => void = setPlayerResults,
  ) {
    setSearch(query)
    const supabase = createClient()
    let q = supabase.from('profiles').select('id, name').order('name').limit(500)
    if (query.trim()) q = (q as any).ilike('name', `%${query}%`)
    const skip = Array.from(new Set((currentUserId ? [currentUserId] : []).concat(excludeIds)))
    if (skip.length > 0) q = q.not('id', 'in', `(${skip.join(',')})`)
    if (division.format === 'mens_doubles' || division.format === 'mens_singles') q = (q as any).eq('gender', 'male')
    else if (division.format === 'womens_doubles' || division.format === 'womens_singles') q = (q as any).eq('gender', 'female')
    const { data } = await q
    setResults(data ?? [])
  }

  async function handleAddPlayer(userId: string, userName: string) {
    setAddPlayerLoading(true); setAddPlayerError(null)
    const res = await fetch(
      `/api/tournaments/${tournamentId}/divisions/${division.id}/register`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }) }
    )
    const json = await res.json()
    if (!res.ok) { setAddPlayerError(json.error ?? 'Failed to add player'); setAddPlayerLoading(false); return }
    setRegistrations(prev => [...prev, { ...json.registration, user_profile: { name: userName } }])
    setAddingPlayer(false); setPlayerSearch(''); setPlayerResults([])
    setAddPlayerLoading(false)
  }

  async function handleAddTeam(p1: { id: string; name: string }, p2: { id: string; name: string }, teamName: string) {
    setAddPlayerLoading(true); setAddPlayerError(null)
    const res = await fetch(
      `/api/tournaments/${tournamentId}/divisions/${division.id}/register`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: p1.id, partner_user_id: p2.id, team_name: teamName || null }) }
    )
    const json = await res.json()
    if (!res.ok) { setAddPlayerError(json.error ?? 'Failed to add team'); setAddPlayerLoading(false); return }
    const reg1 = { ...json.reg1, user_profile: { name: p1.name } }
    const reg2 = { ...json.reg2, user_profile: { name: p2.name } }
    setRegistrations(prev => [...prev, reg1, reg2])
    setAddingPlayer(false); setSelectedP1(null)
    setPlayerSearch(''); setPlayerSearch2(''); setPlayerResults([]); setPlayerResults2([])
    setAddTeamName(''); setAddPlayerLoading(false)
  }

  const existingUserIds = active.map(r => r.user_id)

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
              division.status === 'closed'   ? 'bg-gray-100 text-gray-500'    :
              isFull && !division.waitlist_enabled ? 'bg-red-100 text-red-700' :
                                              'bg-brand-soft text-brand-active'
            }`}>
              {division.status === 'closed' ? 'Closed' : isFull && !division.waitlist_enabled ? 'Full' : 'Open'}
            </span>
          </div>
          <p className="text-xs text-brand-muted">
            <span className="font-semibold text-brand-dark">{active.length}</span> / {maxPlayers} players
          </p>
        </div>

        {/* ── Seeding, schedule, and match generation ── */}
        {isBracket && isOrganizer && (
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
            tournamentDate={tournamentStartDate ?? undefined}
          />
        )}

        {/* ── Bracket ── */}
        {hasMatches && (
          <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
            <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">Bracket</p>
            <BracketView
              matches={matches}
              regs={active.map(r => ({
                id: r.id,
                user_id: r.user_id,
                team_name: r.team_name,
                status: r.status,
                user_profile: r.user_profile ? { name: r.user_profile.name ?? '' } : null,
                partner_user_id: r.partner_user_id,
                partner_profile: r.partner_profile ? { name: r.partner_profile.name ?? '' } : null,
              }))}
              isOrganizer={isOrganizer}
              isDoubles={isDoubles}
              tournamentId={tournamentId}
              divisionId={division.id}
              onScoreUpdate={handleScoreUpdate}
            />
          </div>
        )}

        {/* ── Registrants (non-bracket divisions) ── */}
        {!isBracket && (
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
                    {isOrganizer && (
                      <button onClick={() => handleRemove(r.id)} className="text-red-500 hover:underline shrink-0">Remove</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── Add Player ── */}
        {isOrganizer && !isFull && (
          <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-2">
            {addingPlayer ? (
              <div className="space-y-2">
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
                      <input
                        type="text"
                        value={playerSearch2}
                        onChange={e => searchPlayers(e.target.value, [...existingUserIds, selectedP1.id], setPlayerSearch2, setPlayerResults2)}
                        onFocus={() => searchPlayers(playerSearch2, [...existingUserIds, selectedP1.id], setPlayerSearch2, setPlayerResults2)}
                        placeholder="Search partner by name…"
                        className="w-full input text-xs"
                        autoFocus
                      />
                      {playerResults2.length > 0 && (
                        <ul className="border border-brand-border rounded-xl overflow-y-auto max-h-48">
                          {playerResults2.map(p => (
                            <li key={p.id}>
                              <button
                                onClick={() => handleAddTeam(selectedP1, p, addTeamName)}
                                disabled={addPlayerLoading}
                                className="w-full text-left px-3 py-2 text-xs text-brand-dark hover:bg-brand-soft"
                              >
                                {p.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <input
                        type="text"
                        value={addTeamName}
                        onChange={e => setAddTeamName(e.target.value)}
                        placeholder="Team name (optional)"
                        className="w-full input text-xs"
                      />
                    </>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={playerSearch}
                        onChange={e => searchPlayers(e.target.value, existingUserIds)}
                        onFocus={() => searchPlayers(playerSearch, existingUserIds)}
                        placeholder="Search player 1 by name…"
                        className="w-full input text-xs"
                        autoFocus
                      />
                      {playerResults.length > 0 && (
                        <ul className="border border-brand-border rounded-xl overflow-y-auto max-h-64">
                          {playerResults.map(p => (
                            <li key={p.id}>
                              <button
                                onClick={() => { setSelectedP1(p); setPlayerSearch(''); setPlayerResults([]) }}
                                className="w-full text-left px-3 py-2 text-xs text-brand-dark hover:bg-brand-soft"
                              >
                                {p.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )
                ) : (
                  <>
                    <input
                      type="text"
                      value={playerSearch}
                      onChange={e => searchPlayers(e.target.value, existingUserIds)}
                      onFocus={() => searchPlayers(playerSearch, existingUserIds)}
                      placeholder="Search player by name…"
                      className="w-full input text-xs"
                      autoFocus
                    />
                    {playerResults.length > 0 && (
                      <ul className="border border-brand-border rounded-xl overflow-y-auto max-h-64">
                        {playerResults.map(p => (
                          <li key={p.id}>
                            <button
                              onClick={() => handleAddPlayer(p.id, p.name)}
                              disabled={addPlayerLoading}
                              className="w-full text-left px-3 py-2 text-xs text-brand-dark hover:bg-brand-soft"
                            >
                              {p.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                {addPlayerError && <p className="text-xs text-red-600">{addPlayerError}</p>}
                <button
                  onClick={() => { setAddingPlayer(false); setSelectedP1(null); setPlayerSearch(''); setPlayerSearch2(''); setPlayerResults([]); setPlayerResults2([]); setAddTeamName(''); setAddPlayerError(null) }}
                  className="text-xs text-brand-muted hover:underline"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setAddingPlayer(true); searchPlayers('', existingUserIds) }}
                className="text-xs text-brand-active font-medium hover:underline"
              >
                {isDoubles ? '+ Add Team' : '+ Add Player'}
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
