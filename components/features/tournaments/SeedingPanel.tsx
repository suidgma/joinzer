'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { GripVertical, ArrowUp, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type SeededReg = {
  id: string
  seed?: number | null
  status: string
  payment_status?: string | null
  team_name?: string | null
  registration_type?: 'team' | 'solo'
  partner_registration_id?: string | null
  user_profile: {
    name: string | null
    is_stub?: boolean
    dupr_rating?: number | null
    estimated_rating?: number | null
  } | null
  partner_profile?: {
    name: string | null
    dupr_rating?: number | null
    estimated_rating?: number | null
  } | null
}

export type MatchItem = {
  id: string
  round_number: number
  match_number: number
  team_1_registration_id: string | null
  team_2_registration_id: string | null
  court_number: number | null
  scheduled_time: string | null
  status?: string
}

type ScheduleEdit = { court: string; time: string; date: string }

type Props = {
  registrations: SeededReg[]
  isDoubles: boolean
  tournamentId: string
  divisionId: string
  onMarkComped: (regId: string) => void
  onRemove: (regId: string) => void
  hasMatches: boolean
  onGenerateMatches: (durationMinutes: number) => Promise<void>
  onReplacePlayer?: (regId: string, newUserId: string, newUserName: string) => void
  matches?: MatchItem[]
  /** Elimination divisions label schedule rounds Final/Semi/Quarter; round robin
   *  and pool play just use "Round N" to match the matches view. */
  isElimination?: boolean
  tournamentDate?: string
  addPlayerSlot?: React.ReactNode
  /** Rendered between the roster card and the schedule/generate card (e.g. the bracket/standings view). */
  bracketSlot?: React.ReactNode
  showSeeds?: boolean
  onToggleShowSeeds?: (val: boolean) => void
}

function firstName(name: string | null | undefined): string {
  if (!name) return '?'
  return name.trim().split(/\s+/)[0]
}

function teamRating(reg: SeededReg, isDoubles: boolean): number | null {
  const r1 = reg.user_profile?.dupr_rating ?? reg.user_profile?.estimated_rating ?? null
  if (!isDoubles) return r1
  const r2 = reg.partner_profile?.dupr_rating ?? reg.partner_profile?.estimated_rating ?? null
  if (r1 != null && r2 != null) return (r1 + r2) / 2
  return r1 ?? r2
}

function teamName(reg: SeededReg, isDoubles: boolean): string {
  const p1 = reg.user_profile?.name
  if (!isDoubles) return firstName(p1)
  const p2 = reg.partner_profile?.name
  if (p2) {
    const names = [firstName(p1), firstName(p2)].sort((a, b) => a.localeCompare(b))
    return `${names[0]}/${names[1]}`
  }
  // Partner linked by ID but profile missing, or no partner assigned yet
  return reg.partner_registration_id
    ? `${firstName(p1)}/?`
    : `${firstName(p1)} (no partner)`
}

function isConfirmed(reg: SeededReg) {
  if (['paid', 'waived', 'comped'].includes(reg.payment_status ?? '')) return true
  // Free tournaments: registered players with no payment requirement
  if (reg.payment_status == null && reg.status === 'registered') return true
  return false
}

function paymentBadge(reg: SeededReg) {
  const p = reg.payment_status
  const classes =
    p === 'paid'     ? 'bg-green-100 text-green-700'    :
    p === 'waived'   ? 'bg-gray-100 text-gray-500'      :
    p === 'comped'   ? 'bg-blue-50 text-blue-600'       :
    p === 'refunded' ? 'bg-purple-100 text-purple-700'  :
    p == null        ? 'bg-brand-soft text-brand-active':
                       'bg-red-50 text-red-600'
  const label =
    p === 'paid'     ? '$ Paid'   :
    p === 'waived'   ? 'Waived'   :
    p === 'comped'   ? 'Comped'   :
    p === 'refunded' ? 'Refunded' :
    p == null        ? 'Free'     :
                       '$ Unpaid'
  return <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${classes}`}>{label}</span>
}

function TimeSlotPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parts = value ? value.split(':').map(Number) : []
  const h24 = parts[0] ?? 9
  const rawMin = parts[1] ?? 0
  const minute = [0, 15, 30, 45].includes(rawMin) ? rawMin : 0
  const hour12 = h24 % 12 || 12
  const ampm = h24 < 12 ? 'AM' : 'PM'

  function emit(newH12: number, newAmpm: string, newMin: number) {
    let h = newH12 % 12
    if (newAmpm === 'PM') h += 12
    onChange(`${String(h).padStart(2, '0')}:${String(newMin).padStart(2, '0')}`)
  }

  return (
    <div className="flex items-center gap-1 shrink-0">
      <select
        value={hour12}
        onChange={e => emit(Number(e.target.value), ampm, minute)}
        className="input text-xs py-0.5 px-1 w-12 text-center"
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span className="text-brand-muted text-xs font-bold">:</span>
      <select
        value={minute}
        onChange={e => emit(hour12, ampm, Number(e.target.value))}
        className="input text-xs py-0.5 px-1 w-14 text-center"
      >
        {[0, 15, 30, 45].map(min => (
          <option key={min} value={min}>{String(min).padStart(2, '0')}</option>
        ))}
      </select>
      <select
        value={ampm}
        onChange={e => emit(hour12, e.target.value, minute)}
        className="input text-xs py-0.5 px-1 w-14 text-center"
      >
        <option>AM</option>
        <option>PM</option>
      </select>
    </div>
  )
}

function roundLabel(roundNum: number, totalRounds: number, isElimination: boolean): string {
  // Round robin / pool play have plain numbered rounds — no Final/Semi/Quarter.
  if (!isElimination) return `Round ${roundNum}`
  const fromFinal = totalRounds - roundNum
  if (fromFinal === 0) return 'Final'
  if (fromFinal === 1) return 'Semi-Final'
  if (fromFinal === 2) return 'Quarter-Final'
  return `Round ${roundNum}`
}

function initScheduleEdits(
  matches: MatchItem[] | undefined,
  tournamentDate: string | undefined,
): Record<string, ScheduleEdit> {
  const result: Record<string, ScheduleEdit> = {}
  for (const m of matches ?? []) {
    let timeStr = ''
    let dateStr = tournamentDate ?? ''
    if (m.scheduled_time) {
      const d = new Date(m.scheduled_time)
      if (!isNaN(d.getTime())) {
        // Display the tournament's Pacific wall-clock time, not the browser's
        // local zone — matches the bracket and the -07:00 the save path writes
        // back. en-GB gives 24h "HH:MM"; en-CA gives ISO "YYYY-MM-DD".
        timeStr = d.toLocaleTimeString('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hour12: false })
        dateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
      }
    }
    result[m.id] = { court: m.court_number != null ? String(m.court_number) : '', time: timeStr, date: dateStr }
  }
  return result
}

export default function SeedingPanel({
  registrations, isDoubles, tournamentId, divisionId,
  onMarkComped, onRemove, hasMatches, onGenerateMatches, onReplacePlayer,
  matches, isElimination = false, tournamentDate, addPlayerSlot, bracketSlot, showSeeds, onToggleShowSeeds,
}: Props) {
  // For doubles: keep the lexicographically-smaller registration ID of each pair
  // as the canonical row — matches dedupeRegistrationsToTeams in the bracket generator
  // so the seeding panel and bracket show the same player first for each team.
  // Falls back to whichever row is present when the canonical half has been removed.
  function dedupeForDoubles(regs: SeededReg[]): SeededReg[] {
    if (!isDoubles) return regs
    const regIdSet = new Set(regs.map(r => r.id))
    const handledPairs = new Set<string>()
    const result: SeededReg[] = []
    for (const r of regs) {
      const partnerId = r.partner_registration_id
      if (!partnerId) { result.push(r); continue }
      const canonical = r.id < partnerId ? r.id : partnerId
      if (handledPairs.has(canonical)) continue
      if (r.id === canonical || !regIdSet.has(canonical)) {
        handledPairs.add(canonical)
        result.push(r)
      }
      // else: skip non-canonical row; canonical will be pushed when encountered
    }
    return result
  }

  const confirmed = dedupeForDoubles(registrations.filter(isConfirmed))
  const awaiting  = dedupeForDoubles(registrations.filter(r => !isConfirmed(r)))

  const [order, setOrder] = useState<SeededReg[]>(() => {
    // Saved seeds keep their order; unseeded players default to alphabetical by
    // display name (so a fresh, never-seeded list reads A→Z instead of import order).
    const byName = (a: SeededReg, b: SeededReg) => teamName(a, isDoubles).localeCompare(teamName(b, isDoubles))
    const withSeed = confirmed.filter(r => r.seed != null).sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0))
    const noSeed   = confirmed.filter(r => r.seed == null).sort(byName)
    return [...withSeed, ...noSeed]
  })

  const [locked, setLocked] = useState(() => confirmed.some(r => r.seed != null))

  // Sync order when registrations change (player added or removed from parent)
  useEffect(() => {
    const confirmedNow = dedupeForDoubles(registrations.filter(isConfirmed))
    const confirmedIds = new Set(confirmedNow.map(r => r.id))
    setOrder(prev => {
      const still = prev.filter(r => confirmedIds.has(r.id))
      const existing = new Set(still.map(r => r.id))
      const added = confirmedNow.filter(r => !existing.has(r.id))
      if (still.length === prev.length && added.length === 0) return prev
      return [...still, ...added]
    })
  }, [registrations]) // eslint-disable-line react-hooks/exhaustive-deps
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoSeedDone, setAutoSeedDone] = useState(false)

  const dragIndex = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  // Replace-player state
  const [replacingRegId, setReplacingRegId] = useState<string | null>(null)
  const [replaceSearch, setReplaceSearch] = useState('')
  const [replaceResults, setReplaceResults] = useState<{ id: string; name: string }[]>([])
  const [replaceLoading, setReplaceLoading] = useState(false)
  const [replaceError, setReplaceError] = useState<string | null>(null)

  // Schedule editing state — re-initialize when matches prop changes (e.g. after generate matches)
  const [scheduleEdits, setScheduleEdits] = useState<Record<string, ScheduleEdit>>(
    () => initScheduleEdits(matches, tournamentDate)
  )
  useEffect(() => {
    setScheduleEdits(initScheduleEdits(matches, tournamentDate))
  }, [matches]) // eslint-disable-line react-hooks/exhaustive-deps
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [scheduleSaved, setScheduleSaved] = useState(false)
  const [roundDuration, setRoundDuration] = useState(20)

  // Reset schedule edits when matches change (e.g. after generation)
  const matchIdsKey = (matches ?? []).map(m => m.id).sort().join(',')
  const prevMatchIdsKey = useRef(matchIdsKey)
  useEffect(() => {
    if (matchIdsKey !== prevMatchIdsKey.current) {
      prevMatchIdsKey.current = matchIdsKey
      setScheduleEdits(initScheduleEdits(matches, tournamentDate))
      setScheduleSaved(false)
    }
  }, [matchIdsKey, matches, tournamentDate])

  // Group matches by round
  const rounds = useMemo(() => {
    if (!matches || matches.length === 0) return []
    const byRound = new Map<number, MatchItem[]>()
    for (const m of matches) {
      if (!byRound.has(m.round_number)) byRound.set(m.round_number, [])
      byRound.get(m.round_number)!.push(m)
    }
    return Array.from(byRound.entries())
      .sort(([a], [b]) => a - b)
      .map(([roundNum, ms]) => ({ roundNum, matches: ms.sort((a, b) => a.match_number - b.match_number) }))
  }, [matches])

  const totalRounds = rounds.length

  // Map registration IDs → display names for match labels
  const regNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const reg of registrations.filter(r => r.status !== 'cancelled')) {
      const base = teamName(reg, isDoubles)
      map.set(reg.id, showSeeds && reg.seed != null ? `#${reg.seed} ${base}` : base)
    }
    return map
  }, [registrations, isDoubles, showSeeds])

  // Map registration IDs → seed position (0-based) for match display ordering
  const seedIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    order.forEach((r, i) => map.set(r.id, i))
    return map
  }, [order])

  function handleDragStart(i: number) { if (!locked) dragIndex.current = i }
  function handleDragOver(e: React.DragEvent, i: number) { if (!locked) { e.preventDefault(); setDragOver(i) } }
  function handleDrop(i: number) {
    if (locked) return
    const from = dragIndex.current
    if (from === null || from === i) { setDragOver(null); return }
    const next = [...order]
    const [moved] = next.splice(from, 1)
    next.splice(i, 0, moved)
    setOrder(next)
    setAutoSeedDone(false)
    setDragOver(null)
  }
  function handleDragEnd() { dragIndex.current = null; setDragOver(null) }

  function autoSeed() {
    const sorted = [...order].sort((a, b) => {
      const ra = teamRating(a, isDoubles) ?? -Infinity
      const rb = teamRating(b, isDoubles) ?? -Infinity
      return rb - ra
    })
    setOrder(sorted)
    setAutoSeedDone(true)
  }

  async function save() {
    setSaving(true); setError(null)
    try {
      const seeds = order.map((reg, i) => ({ id: reg.id, seed: i + 1 }))
      const res = await fetch(
        `/api/tournaments/${tournamentId}/divisions/${divisionId}/seeds`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seeds }) }
      )
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Save failed') }
      else { setLocked(true); setAutoSeedDone(false) }
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  async function saveSchedule() {
    setScheduleSaving(true); setScheduleError(null); setScheduleSaved(false)
    try {
      const updates = Object.entries(scheduleEdits).map(([id, edit]) => {
        const court = parseInt(edit.court)
        const iso = edit.date && edit.time ? `${edit.date}T${edit.time}:00-07:00` : null
        return { id, court_number: isNaN(court) ? null : court, scheduled_time: iso }
      })
      const res = await fetch(
        `/api/tournaments/${tournamentId}/schedule`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates }) }
      )
      if (!res.ok) { const d = await res.json().catch(() => ({})); setScheduleError(d.error ?? 'Save failed') }
      else setScheduleSaved(true)
    } catch { setScheduleError('Network error') }
    finally { setScheduleSaving(false) }
  }

  async function searchForReplacement(query: string) {
    setReplaceSearch(query)
    if (!query.trim()) { setReplaceResults([]); return }
    const supabase = createClient()
    const { data } = await supabase
      .from('profiles')
      .select('id, name')
      .ilike('name', `%${query}%`)
      .limit(20)
    setReplaceResults(data ?? [])
  }

  async function handleReplace(regId: string, newPlayer: { id: string; name: string }) {
    setReplaceLoading(true); setReplaceError(null)
    try {
      const res = await fetch(
        `/api/tournaments/${tournamentId}/registrations/${regId}/replace-player`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_user_id: newPlayer.id }) }
      )
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setReplaceError(d.error ?? 'Replacement failed')
        return
      }
      // Update local order state with new player name
      setOrder(prev => prev.map(r =>
        r.id === regId
          ? { ...r, user_profile: { ...r.user_profile, name: newPlayer.name, is_stub: false } }
          : r
      ))
      // Also update the regNameMap by refreshing it via the registrations prop update
      onReplacePlayer?.(regId, newPlayer.id, newPlayer.name)
      setReplacingRegId(null)
      setReplaceSearch('')
      setReplaceResults([])
    } catch {
      setReplaceError('Network error')
    } finally {
      setReplaceLoading(false)
    }
  }

  const hasRatings = order.some(r => teamRating(r, isDoubles) != null)

  return (
    <>
      {/* ── Card 1: roster, seeds, add player ── */}
      <div className="border border-brand-border rounded-xl overflow-hidden">
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-brand-border bg-brand-surface">
          <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">Seeding &amp; Registrants</p>
          <div className="flex items-center gap-2">
            {!locked && hasRatings && (
              autoSeedDone ? (
                <span className="text-xs text-green-600 font-medium">Sorted by rating — save to lock in</span>
              ) : (
                <button onClick={autoSeed} className="text-xs text-brand-active hover:underline">
                  Auto-seed by rating
                </button>
              )
            )}
            {order.length > 0 && (
              locked ? (
                <button
                  onClick={() => setLocked(false)}
                  className="px-3 py-1 rounded-lg border border-brand-border text-brand-muted text-xs font-semibold hover:bg-brand-soft transition-colors"
                >
                  🔒 Edit Seeds
                </button>
              ) : (
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-3 py-1 rounded-lg bg-brand text-brand-dark text-xs font-semibold hover:bg-brand/80 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save Seeds'}
                </button>
              )
            )}
          </div>
        </div>

        {error && <p className="px-3 py-1 text-xs text-red-600 bg-red-50">{error}</p>}

        {/* ── Player list (always visible) ── */}
        {registrations.length === 0 ? (
          <p className="px-3 py-3 text-xs text-brand-muted">No registrants yet.</p>
        ) : (
          <ul className="divide-y divide-brand-border/60">
            {order.map((reg, i) => {
              const rating = teamRating(reg, isDoubles)
              const canComp = reg.payment_status !== 'paid' && reg.payment_status !== 'refunded' && reg.payment_status !== 'comped'
              const isReplacing = replacingRegId === reg.id
              return (
                <li key={reg.id} className="text-xs">
                  {/* Player row */}
                  <div
                    draggable={!locked && !isReplacing}
                    onDragStart={() => handleDragStart(i)}
                    onDragOver={e => handleDragOver(e, i)}
                    onDrop={() => handleDrop(i)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-2 px-3 py-2 transition-colors ${
                      !locked && dragOver === i ? 'bg-brand-soft' : 'bg-white'
                    } ${!locked && !isReplacing ? 'hover:bg-brand-soft/30' : ''}`}
                  >
                    <GripVertical className={`w-3.5 h-3.5 shrink-0 ${locked ? 'text-brand-border' : 'text-brand-muted cursor-grab active:cursor-grabbing'}`} />
                    <span className="w-5 text-[10px] font-bold text-brand-muted text-right shrink-0">{i + 1}</span>
                    <span className="flex-1 font-medium text-brand-dark truncate">{teamName(reg, isDoubles)}</span>
                    {reg.user_profile?.is_stub && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700">Invited</span>
                    )}
                    {paymentBadge(reg)}
                    {rating != null && <span className="text-[10px] text-brand-muted shrink-0 w-8 text-right">{rating.toFixed(2)}</span>}
                    <div className="flex shrink-0 items-center gap-2 ml-1">
                      <button
                        onClick={() => {
                          setReplacingRegId(isReplacing ? null : reg.id)
                          setReplaceSearch(''); setReplaceResults([]); setReplaceError(null)
                        }}
                        className={`hover:underline whitespace-nowrap ${isReplacing ? 'text-brand-muted' : 'text-amber-600'}`}
                      >
                        {isReplacing ? 'Cancel' : 'Replace'}
                      </button>
                      {canComp && (
                        <button onClick={() => onMarkComped(reg.id)} className="text-brand-active hover:underline whitespace-nowrap">
                          Comp
                        </button>
                      )}
                      <button onClick={() => onRemove(reg.id)} className="text-red-500 hover:underline">
                        Remove
                      </button>
                    </div>
                  </div>

                  {/* Inline Replace Player UI */}
                  {isReplacing && (
                    <div className="px-3 pb-2 pt-1 bg-amber-50 border-t border-amber-100 space-y-1.5">
                      <p className="text-[10px] font-semibold text-amber-800 uppercase tracking-wide">Replace player in this bracket slot</p>
                      <input
                        type="text"
                        value={replaceSearch}
                        onChange={e => searchForReplacement(e.target.value)}
                        placeholder="Search by name…"
                        className="w-full input text-xs"
                        autoFocus
                      />
                      {replaceResults.length > 0 && (
                        <ul className="border border-brand-border rounded-xl overflow-y-auto max-h-40 bg-white">
                          {replaceResults.map(p => (
                            <li key={p.id}>
                              <button
                                onClick={() => handleReplace(reg.id, p)}
                                disabled={replaceLoading}
                                className="w-full text-left px-3 py-2 text-xs text-brand-dark hover:bg-brand-soft transition-colors"
                              >
                                {p.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {replaceError && <p className="text-xs text-red-600">{replaceError}</p>}
                      <p className="text-[10px] text-amber-700">Replacement inherits this seed position and payment status.</p>
                    </div>
                  )}
                </li>
              )
            })}

            {awaiting.length > 0 && (
              <>
                <li className="px-3 py-1 bg-brand-surface">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 border-t border-brand-border/60" />
                    <span className="text-[10px] font-semibold text-brand-muted whitespace-nowrap">
                      Awaiting payment · {awaiting.length}
                    </span>
                    <div className="flex-1 border-t border-brand-border/60" />
                  </div>
                </li>
                {awaiting.map(reg => {
                  const canComp = reg.payment_status !== 'paid' && reg.payment_status !== 'refunded' && reg.payment_status !== 'comped'
                  return (
                    <li key={reg.id} className="flex items-center gap-2 px-3 py-2 text-xs bg-white opacity-60">
                      <div className="w-3.5 shrink-0" />
                      <div className="w-5 shrink-0" />
                      <span className="flex-1 font-medium text-brand-dark truncate">{teamName(reg, isDoubles)}</span>
                      {reg.user_profile?.is_stub && (
                        <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700">Invited</span>
                      )}
                      {paymentBadge(reg)}
                      <div className="flex shrink-0 items-center gap-2 ml-1">
                        {canComp && (
                          <button onClick={() => onMarkComped(reg.id)} className="text-brand-active hover:underline whitespace-nowrap">
                            Comp
                          </button>
                        )}
                        <button onClick={() => onRemove(reg.id)} className="text-red-500 hover:underline">
                          Remove
                        </button>
                      </div>
                    </li>
                  )
                })}
              </>
            )}
          </ul>
        )}

        {/* ── Re-order affordance hint. When unlocked the rows are draggable; when
              locked it points the organizer at Edit Seeds so the affordance is
              discoverable in both states. ── */}
        {order.length > 1 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-brand-border/60 text-[10px] font-medium text-brand-muted">
            {locked ? (
              <><Lock className="w-3 h-3 shrink-0" /><span>Edit Seeds to re-order</span></>
            ) : (
              <><ArrowUp className="w-3 h-3 shrink-0" /><span>Drag to re-order</span></>
            )}
          </div>
        )}

        {/* ── Add Player slot ── */}
        {addPlayerSlot && (
          <div className="border-t border-brand-border px-3 py-2.5">
            {addPlayerSlot}
          </div>
        )}
      </div>

      {/* ── Bracket / Standings — sits between the roster and the schedule tools ── */}
      {bracketSlot}

      {/* ── Card 2: match schedule + generate ── */}
      <div className="border border-brand-border rounded-xl overflow-hidden divide-y divide-brand-border/60">
        {/* ── Match Schedule (inline, when matches exist) ── */}
        {hasMatches && rounds.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-3 py-2 bg-brand-surface border-b border-brand-border/60">
              <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">Match Schedule</p>
              <div className="flex items-center gap-2">
                {scheduleSaved && <span className="text-[10px] text-green-600 font-semibold">✓ Saved</span>}
                <button
                  onClick={saveSchedule}
                  disabled={scheduleSaving}
                  className="px-3 py-1 rounded-lg bg-brand text-brand-dark text-xs font-semibold hover:bg-brand/80 disabled:opacity-50 transition-colors"
                >
                  {scheduleSaving ? 'Saving…' : 'Save Schedule'}
                </button>
              </div>
            </div>
            {scheduleError && <p className="px-3 py-1 text-xs text-red-600 bg-red-50">{scheduleError}</p>}
            <div className="divide-y divide-brand-border/40">
              {rounds.map(({ roundNum, matches: roundMatches }) => (
                <div key={roundNum} className="px-3 py-2 space-y-3">
                  <p className="text-[10px] font-bold text-brand-muted uppercase tracking-wider">
                    {roundLabel(roundNum, totalRounds, isElimination)}
                  </p>
                  {roundMatches.map(m => {
                    const rawName1 = m.team_1_registration_id
                      ? (regNameMap.get(m.team_1_registration_id) ?? 'TBD')
                      : (roundNum === 1 ? 'BYE' : 'TBD')
                    const rawName2 = m.team_2_registration_id
                      ? (regNameMap.get(m.team_2_registration_id) ?? 'TBD')
                      : (roundNum === 1 ? 'BYE' : 'TBD')
                    // Display lower seed first regardless of team_1/team_2 slot assignment
                    const s1 = m.team_1_registration_id != null ? (seedIndexMap.get(m.team_1_registration_id) ?? Infinity) : Infinity
                    const s2 = m.team_2_registration_id != null ? (seedIndexMap.get(m.team_2_registration_id) ?? Infinity) : Infinity
                    const [name1, name2] = s1 <= s2 ? [rawName1, rawName2] : [rawName2, rawName1]
                    const edit = scheduleEdits[m.id] ?? { court: '', time: '', date: tournamentDate ?? '' }
                    return (
                      <div key={m.id} className="space-y-1.5">
                        <span className="text-xs font-medium text-brand-dark">{name1} vs {name2}</span>
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-brand-muted">Ct.</span>
                            <input
                              type="number"
                              min="1"
                              value={edit.court}
                              onChange={e => setScheduleEdits(prev => ({ ...prev, [m.id]: { ...edit, court: e.target.value } }))}
                              placeholder="—"
                              className="w-11 input text-xs py-0.5 px-1.5 text-center"
                            />
                          </div>
                          <input
                            type="date"
                            value={edit.date}
                            onChange={e => setScheduleEdits(prev => ({ ...prev, [m.id]: { ...edit, date: e.target.value } }))}
                            className="input text-xs py-0.5 px-1.5 flex-1 min-w-[130px]"
                          />
                          <TimeSlotPicker
                            value={edit.time}
                            onChange={time => setScheduleEdits(prev => ({ ...prev, [m.id]: { ...edit, time } }))}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Generate / Re-generate Matches ── */}
        <div className="px-3 py-2.5 bg-brand-surface space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-brand-muted shrink-0">Time per round</span>
            <select
              value={roundDuration}
              onChange={e => setRoundDuration(Number(e.target.value))}
              className="input text-xs py-0.5 px-2 flex-1"
            >
              <option value={15}>15 min</option>
              <option value={20}>20 min</option>
              <option value={30}>30 min</option>
              <option value={45}>45 min</option>
              <option value={60}>1 hour</option>
              <option value={90}>1.5 hours</option>
              <option value={120}>2 hours</option>
            </select>
          </div>
          {onToggleShowSeeds && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!showSeeds}
                onChange={e => onToggleShowSeeds(e.target.checked)}
                className="rounded border-brand-border text-brand accent-brand"
              />
              <span className="text-xs text-brand-muted">Show seed numbers next to names</span>
            </label>
          )}
          <button
            onClick={async () => {
              setGenerating(true); setGenError(null)
              try { await onGenerateMatches(roundDuration) }
              catch (e: unknown) { setGenError(e instanceof Error ? e.message : 'Failed') }
              finally { setGenerating(false) }
            }}
            disabled={generating || confirmed.length < 2}
            className="w-full py-2 rounded-lg bg-brand-dark text-white text-sm font-semibold hover:bg-brand-dark/90 disabled:opacity-50 transition-colors"
          >
            {generating ? 'Generating…' : hasMatches ? 'Re-generate Matches' : 'Generate Matches'}
          </button>
          {genError && <p className="text-xs text-red-600">{genError}</p>}
          {confirmed.length < 2 && (
            <p className="text-[10px] text-brand-muted">Need at least 2 confirmed registrants to generate.</p>
          )}
          <p className="text-[10px] text-brand-muted">
            {locked
              ? '🔒 Seeds locked · Click "Edit Seeds" to reorder · Re-generate to apply new order'
              : 'Drag to reorder · Seed 1 gets the best bracket position · Save Seeds to lock'}
          </p>
        </div>
      </div>
    </>
  )
}
