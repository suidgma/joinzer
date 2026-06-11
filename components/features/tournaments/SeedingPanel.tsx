'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { GripVertical } from 'lucide-react'

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
  onGenerateMatches: () => Promise<void>
  matches?: MatchItem[]
  tournamentDate?: string
}

function lastName(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1]
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
  if (!isDoubles) return p1 ?? '—'
  const p2 = reg.partner_profile?.name
  if (p2) return `${lastName(p1)} / ${lastName(p2)}`
  return lastName(p1)
}

function isConfirmed(reg: SeededReg) {
  if (['paid', 'waived', 'comped'].includes(reg.payment_status ?? '')) return true
  // Free tournaments: registered players with no payment status
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

function roundLabel(roundNum: number, totalRounds: number): string {
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
      timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      dateStr = d.toISOString().slice(0, 10)
    }
    result[m.id] = { court: m.court_number != null ? String(m.court_number) : '', time: timeStr, date: dateStr }
  }
  return result
}

export default function SeedingPanel({
  registrations, isDoubles, tournamentId, divisionId,
  onMarkComped, onRemove, hasMatches, onGenerateMatches,
  matches, tournamentDate,
}: Props) {
  const confirmed = registrations.filter(isConfirmed)
  const awaiting  = registrations.filter(r => !isConfirmed(r))

  const [order, setOrder] = useState<SeededReg[]>(() => {
    const withSeed = confirmed.filter(r => r.seed != null).sort((a, b) => (a.seed ?? 0) - (b.seed ?? 0))
    const noSeed   = confirmed.filter(r => r.seed == null)
    return withSeed.length > 0 ? [...withSeed, ...noSeed] : [...confirmed]
  })

  const [locked, setLocked] = useState(() => confirmed.some(r => r.seed != null))
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dragIndex = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  // Schedule editing state
  const [scheduleEdits, setScheduleEdits] = useState<Record<string, ScheduleEdit>>(
    () => initScheduleEdits(matches, tournamentDate)
  )
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [scheduleSaved, setScheduleSaved] = useState(false)

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

  // Group matches by round for the schedule section
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
      map.set(reg.id, teamName(reg, isDoubles))
    }
    return map
  }, [registrations, isDoubles])

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
      else setLocked(true)
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

  const hasRatings = order.some(r => teamRating(r, isDoubles) != null)

  return (
    <div className="border border-brand-border rounded-xl overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-brand-border bg-brand-surface">
        <p className="text-xs font-semibold text-brand-dark uppercase tracking-wide">Seeding &amp; Registrants</p>
        <div className="flex items-center gap-2">
          {!locked && hasRatings && (
            <button onClick={autoSeed} className="text-xs text-brand-active hover:underline">
              Auto-seed by rating
            </button>
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
            return (
              <li
                key={reg.id}
                draggable={!locked}
                onDragStart={() => handleDragStart(i)}
                onDragOver={e => handleDragOver(e, i)}
                onDrop={() => handleDrop(i)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                  !locked && dragOver === i ? 'bg-brand-soft' : 'bg-white'
                } ${!locked ? 'hover:bg-brand-soft/30' : ''}`}
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
                  {canComp && (
                    <button onClick={() => onMarkComped(reg.id)} className="text-brand-active hover:underline whitespace-nowrap">
                      Mark Comped
                    </button>
                  )}
                  <button onClick={() => onRemove(reg.id)} className="text-red-500 hover:underline">
                    Remove
                  </button>
                </div>
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
                          Mark Comped
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

      {/* ── Match Schedule (inline, when matches exist) ── */}
      {hasMatches && rounds.length > 0 && (
        <div className="border-t border-brand-border">
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
              <div key={roundNum} className="px-3 py-2 space-y-2">
                <p className="text-[10px] font-bold text-brand-muted uppercase tracking-wider">
                  {roundLabel(roundNum, totalRounds)}
                </p>
                {roundMatches.map(m => {
                  // Round 1 null = actual BYE; later rounds null = winner TBD
                  const name1 = m.team_1_registration_id
                    ? (regNameMap.get(m.team_1_registration_id) ?? 'TBD')
                    : (roundNum === 1 ? 'BYE' : 'TBD')
                  const name2 = m.team_2_registration_id
                    ? (regNameMap.get(m.team_2_registration_id) ?? 'TBD')
                    : (roundNum === 1 ? 'BYE' : 'TBD')
                  const edit = scheduleEdits[m.id] ?? { court: '', time: '', date: tournamentDate ?? '' }
                  return (
                    <div key={m.id} className="space-y-1.5">
                      <span className="text-xs text-brand-dark font-medium">{name1} vs {name2}</span>
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
                        <input
                          type="time"
                          value={edit.time}
                          onChange={e => setScheduleEdits(prev => ({ ...prev, [m.id]: { ...edit, time: e.target.value } }))}
                          className="input text-xs py-0.5 px-1.5 w-24 shrink-0"
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
      <div className="px-3 py-2.5 border-t border-brand-border/60 bg-brand-surface space-y-1.5">
        <button
          onClick={async () => {
            setGenerating(true); setGenError(null)
            try { await onGenerateMatches() }
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
  )
}
