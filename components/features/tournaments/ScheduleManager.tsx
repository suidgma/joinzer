'use client'

import { useState, useMemo } from 'react'

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
  status: string
}

type Registration = {
  id: string
  user_id: string
  team_name: string | null
  user_profile: { name: string } | null
}

type Division = {
  id: string
  name: string
  tournament_registrations: Registration[]
}

type Props = {
  tournamentId: string
  initialMatches: Match[]
  divisions: Division[]
  tournamentDate: string        // YYYY-MM-DD
  defaultStartTime: string      // HH:MM
  defaultEndTime: string | null // HH:MM or null
}

function teamLabel(regId: string | null, regs: Registration[]): string {
  if (!regId) return 'BYE'
  const r = regs.find(x => x.id === regId)
  if (!r) return '—'
  return r.team_name || r.user_profile?.name || regId.slice(0, 8)
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

function formatScheduledTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric', minute: '2-digit',
  })
}

function scheduledDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toISOString().slice(0, 10)
}

function scheduledHHMM(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const h = d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', hour12: false })
  const min = d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', minute: '2-digit' })
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

// Generate schedule: group matches into time waves, assign courts cyclically
function generateSchedule(
  matches: Match[],
  date: string,
  startTime: string,
  matchDuration: number,
  firstCourt: number,
  lastCourt: number,
): { id: string; court_number: number; scheduled_time: string }[] {
  const courts = Array.from({ length: lastCourt - firstCourt + 1 }, (_, i) => firstCourt + i)
  if (courts.length === 0) return []

  const sorted = [...matches].sort((a, b) => {
    const ra = a.round_number ?? 999
    const rb = b.round_number ?? 999
    if (ra !== rb) return ra - rb
    return a.match_number - b.match_number
  })

  const startMin = toMinutes(startTime)
  const numCourts = courts.length
  const result: { id: string; court_number: number; scheduled_time: string }[] = []

  const rounds = new Map<number, Match[]>()
  for (const m of sorted) {
    const r = m.round_number ?? 0
    if (!rounds.has(r)) rounds.set(r, [])
    rounds.get(r)!.push(m)
  }

  let waveIndex = 0
  for (const [, roundMatches] of Array.from(rounds.entries()).sort(([a], [b]) => a - b)) {
    for (let i = 0; i < roundMatches.length; i += numCourts) {
      const batch = roundMatches.slice(i, i + numCourts)
      const timeMin = startMin + waveIndex * matchDuration
      const hhmm = fromMinutes(timeMin)
      const iso = `${date}T${hhmm}:00-07:00`
      batch.forEach((m, j) => {
        result.push({
          id: m.id,
          court_number: courts[j % numCourts],
          scheduled_time: iso,
        })
      })
      waveIndex++
    }
  }

  return result
}

export default function ScheduleManager({ tournamentId, initialMatches, divisions, tournamentDate, defaultStartTime, defaultEndTime }: Props) {
  const [matches, setMatches] = useState<Match[]>(initialMatches)
  const [showGenerator, setShowGenerator] = useState(false)

  // Generator inputs
  const [genDate, setGenDate] = useState(tournamentDate)
  const [genStartTime, setGenStartTime] = useState(defaultStartTime || '08:00')
  const [genEndTime, setGenEndTime] = useState(defaultEndTime || '17:00')
  const [genDuration, setGenDuration] = useState(45)
  const [genFirstCourt, setGenFirstCourt] = useState(11)
  const [genLastCourt, setGenLastCourt] = useState(24)

  // Edits pending save
  const [edits, setEdits] = useState<Record<string, { court_number: string; date: string; time: string }>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [generateResult, setGenerateResult] = useState<{ divisionId: string; name: string; matchCount: number; skipped?: string }[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const allRegs: Registration[] = divisions.flatMap(d => d.tournament_registrations)

  const playableMatches = useMemo(() =>
    matches.filter(m => m.team_1_registration_id || m.team_2_registration_id),
    [matches]
  )

  const scheduledMatches = useMemo(() =>
    [...playableMatches].sort((a, b) => {
      const ta = a.scheduled_time ?? '9999'
      const tb = b.scheduled_time ?? '9999'
      if (ta !== tb) return ta.localeCompare(tb)
      const ca = a.court_number ?? 999
      const cb = b.court_number ?? 999
      if (ca !== cb) return ca - cb
      return a.match_number - b.match_number
    }),
    [playableMatches]
  )

  const numCourts = Math.max(1, genLastCourt - genFirstCourt + 1)
  const numWaves = Math.ceil(playableMatches.length / numCourts)
  const estimatedEndMin = toMinutes(genStartTime) + numWaves * genDuration
  const estimatedEndTime = fromMinutes(estimatedEndMin)
  const overrun = estimatedEndMin > toMinutes(genEndTime)

  // Step 1: generate all brackets, then immediately schedule
  async function handleGenerateTournament() {
    setGenerating(true)
    setGenerateError(null)
    setGenerateResult(null)

    // Generate brackets for all divisions without matches
    const hasExistingMatches = matches.length > 0
    let allMatches = [...matches]

    if (!hasExistingMatches) {
      const res = await fetch(`/api/tournaments/${tournamentId}/generate-all`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        setGenerateError(data.error ?? 'Failed to generate brackets')
        setGenerating(false)
        return
      }

      // Merge new matches into local state
      const newMatches = (data.matches ?? []) as Match[]
      allMatches = [...allMatches, ...newMatches]
      setMatches(allMatches)
      setGenerateResult(data.divisions)
    }

    // Schedule all playable matches
    const playable = allMatches.filter(m => m.team_1_registration_id || m.team_2_registration_id)
    const generated = generateSchedule(playable, genDate, genStartTime, genDuration, genFirstCourt, genLastCourt)

    const genMap = new Map(generated.map(g => [g.id, g]))
    setMatches(prev => prev.map(m => {
      const g = genMap.get(m.id)
      if (!g) return m
      return { ...m, court_number: g.court_number, scheduled_time: g.scheduled_time }
    }))

    const newEdits: Record<string, { court_number: string; date: string; time: string }> = {}
    for (const g of generated) {
      newEdits[g.id] = {
        court_number: String(g.court_number),
        date: genDate,
        time: scheduledHHMM(g.scheduled_time),
      }
    }
    setEdits(newEdits)
    setShowGenerator(false)
    setSaveSuccess(false)
    setGenerating(false)
  }

  // Re-schedule only (brackets already exist)
  function handleReschedule() {
    const generated = generateSchedule(playableMatches, genDate, genStartTime, genDuration, genFirstCourt, genLastCourt)
    const genMap = new Map(generated.map(g => [g.id, g]))
    setMatches(prev => prev.map(m => {
      const g = genMap.get(m.id)
      if (!g) return m
      return { ...m, court_number: g.court_number, scheduled_time: g.scheduled_time }
    }))
    const newEdits: Record<string, { court_number: string; date: string; time: string }> = {}
    for (const g of generated) {
      newEdits[g.id] = {
        court_number: String(g.court_number),
        date: genDate,
        time: scheduledHHMM(g.scheduled_time),
      }
    }
    setEdits(newEdits)
    setShowGenerator(false)
    setSaveSuccess(false)
  }

  function startEdit(m: Match) {
    setEditingId(m.id)
    setEdits(prev => ({
      ...prev,
      [m.id]: {
        court_number: String(m.court_number ?? ''),
        date: scheduledDate(m.scheduled_time) || genDate,
        time: scheduledHHMM(m.scheduled_time) || genStartTime,
      },
    }))
  }

  function updateEdit(id: string, field: 'court_number' | 'date' | 'time', value: string) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  function applyEdit(id: string) {
    const e = edits[id]
    if (!e) { setEditingId(null); return }
    const court = parseInt(e.court_number)
    const iso = e.date && e.time ? `${e.date}T${e.time}:00-07:00` : null
    setMatches(prev => prev.map(m =>
      m.id === id ? { ...m, court_number: isNaN(court) ? null : court, scheduled_time: iso } : m
    ))
    setEditingId(null)
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    const updates = Object.entries(edits).map(([id, e]) => {
      const court = parseInt(e.court_number)
      const iso = e.date && e.time ? `${e.date}T${e.time}:00-07:00` : null
      return { id, court_number: isNaN(court) ? null : court, scheduled_time: iso }
    })

    const res = await fetch(`/api/tournaments/${tournamentId}/schedule`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    })

    if (res.ok) {
      setEdits({})
      setSaveSuccess(true)
    } else {
      const data = await res.json().catch(() => ({}))
      setSaveError(data.error ?? 'Save failed')
    }
    setSaving(false)
  }

  const divisionName = (divId: string) => divisions.find(d => d.id === divId)?.name ?? ''
  const hasPendingEdits = Object.keys(edits).length > 0
  const hasMatches = matches.length > 0

  const byTimeSlot = useMemo(() => {
    const groups = new Map<string, Match[]>()
    for (const m of scheduledMatches) {
      const key = m.scheduled_time ?? '__unscheduled__'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(m)
    }
    return groups
  }, [scheduledMatches])

  const unscheduled = matches.filter(m => !m.scheduled_time && (m.team_1_registration_id || m.team_2_registration_id))

  return (
    <div className="space-y-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-base font-bold text-brand-dark">Schedule</h2>
        <button
          onClick={() => setShowGenerator(!showGenerator)}
          className="text-sm font-medium text-brand-active hover:underline"
        >
          {showGenerator ? 'Close' : hasMatches ? '⚙ Reschedule' : '⚙ Generate Tournament'}
        </button>
      </div>

      {/* Generator panel */}
      {showGenerator && (
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-4">
          <div>
            <h3 className="font-heading text-sm font-bold text-brand-dark">
              {hasMatches ? 'Regenerate Schedule' : 'Generate Full Tournament'}
            </h3>
            {!hasMatches && (
              <p className="text-xs text-brand-muted mt-0.5">
                Creates brackets for all divisions and assigns courts + times in one step.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-brand-muted mb-1">Date</label>
              <input type="date" value={genDate} onChange={e => setGenDate(e.target.value)} className="w-full input" />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Start Time</label>
              <input type="time" value={genStartTime} onChange={e => setGenStartTime(e.target.value)} className="w-full input" />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">End Time</label>
              <input type="time" value={genEndTime} onChange={e => setGenEndTime(e.target.value)} className="w-full input" />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Match Duration (min)</label>
              <input
                type="number" min="15" step="5"
                value={genDuration}
                onChange={e => setGenDuration(parseInt(e.target.value) || 45)}
                className="w-full input"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-brand-muted mb-1">Courts (Sunset Park)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="1" max="100"
                  value={genFirstCourt}
                  onChange={e => setGenFirstCourt(parseInt(e.target.value) || 11)}
                  className="w-full input text-center"
                  placeholder="First"
                />
                <span className="text-brand-muted text-sm flex-shrink-0">–</span>
                <input
                  type="number" min="1" max="100"
                  value={genLastCourt}
                  onChange={e => setGenLastCourt(parseInt(e.target.value) || 24)}
                  className="w-full input text-center"
                  placeholder="Last"
                />
              </div>
              <p className="text-xs text-brand-muted mt-1">
                {numCourts} court{numCourts !== 1 ? 's' : ''} · {numWaves > 0 ? `${numWaves} time slot${numWaves !== 1 ? 's' : ''}` : 'brackets generate on confirm'}
              </p>
            </div>
          </div>

          {/* End-time estimate */}
          {(hasMatches || numWaves > 0) && (
            <div className={`rounded-xl px-3 py-2.5 text-xs ${overrun ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-brand-soft border border-brand-border text-brand-body'}`}>
              {overrun
                ? `⚠ Estimated finish ${formatTime12(estimatedEndTime)} exceeds your end time of ${formatTime12(genEndTime)}. Add more courts or extend end time.`
                : `Estimated finish: ${formatTime12(estimatedEndTime)}`
              }
            </div>
          )}

          {generateError && <p className="text-xs text-red-600">{generateError}</p>}

          <button
            onClick={hasMatches ? handleReschedule : handleGenerateTournament}
            disabled={generating}
            className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
          >
            {generating
              ? 'Generating…'
              : hasMatches
                ? 'Regenerate Schedule'
                : 'Generate Full Tournament'}
          </button>
          <p className="text-xs text-brand-muted text-center">
            Review the schedule below, make any edits, then save.
          </p>
        </div>
      )}

      {/* Generation result summary */}
      {generateResult && (
        <div className="bg-brand-soft border border-brand-border rounded-xl px-3 py-2.5 space-y-1">
          <p className="text-xs font-semibold text-brand-dark">Brackets generated</p>
          {generateResult.map(r => (
            <p key={r.divisionId} className="text-xs text-brand-muted">
              {r.name}: {r.skipped ? <span className="text-amber-600">{r.skipped}</span> : `${r.matchCount} match${r.matchCount !== 1 ? 'es' : ''}`}
            </p>
          ))}
        </div>
      )}

      {/* Save bar */}
      {hasPendingEdits && (
        <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <p className="text-xs text-amber-800 font-medium">{Object.keys(edits).length} unsaved change{Object.keys(edits).length !== 1 ? 's' : ''}</p>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Schedule'}
          </button>
        </div>
      )}
      {saveError && <p className="text-xs text-red-600">{saveError}</p>}
      {saveSuccess && !hasPendingEdits && (
        <p className="text-xs text-green-600 font-medium">✓ Schedule saved</p>
      )}

      {/* Empty state */}
      {scheduledMatches.length === 0 && unscheduled.length === 0 && (
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
          <p className="text-2xl">🏆</p>
          <p className="text-sm font-medium text-brand-dark">No schedule yet</p>
          <p className="text-xs text-brand-muted">Click ⚙ Generate Tournament to build brackets and assign courts in one step.</p>
        </div>
      )}

      {/* Schedule by time slot */}
      {byTimeSlot.size > 0 && (
        <div className="space-y-4">
          {Array.from(byTimeSlot.entries()).map(([timeKey, slotMatches]) => (
            <div key={timeKey} className="space-y-1.5">
              <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">
                {timeKey === '__unscheduled__' ? 'Unscheduled' : formatScheduledTime(timeKey)}
              </p>
              <div className="space-y-1.5">
                {slotMatches.map(m => {
                  const isEditing = editingId === m.id
                  const e = edits[m.id]
                  const isPending = !!edits[m.id] && !isEditing
                  const divName = divisionName(m.division_id)
                  const t1 = teamLabel(m.team_1_registration_id, allRegs)
                  const t2 = teamLabel(m.team_2_registration_id, allRegs)

                  return (
                    <div
                      key={m.id}
                      className={`bg-brand-surface border rounded-xl p-3 ${isPending ? 'border-amber-300' : 'border-brand-border'}`}
                    >
                      {isEditing ? (
                        <div className="space-y-2">
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-[10px] font-medium text-brand-muted mb-0.5">Court</label>
                              <input
                                type="number" min="1"
                                value={e?.court_number ?? ''}
                                onChange={ev => updateEdit(m.id, 'court_number', ev.target.value)}
                                className="w-full input text-sm text-center"
                                autoFocus
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-medium text-brand-muted mb-0.5">Date</label>
                              <input
                                type="date"
                                value={e?.date ?? ''}
                                onChange={ev => updateEdit(m.id, 'date', ev.target.value)}
                                className="w-full input text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-medium text-brand-muted mb-0.5">Time</label>
                              <input
                                type="time"
                                value={e?.time ?? ''}
                                onChange={ev => updateEdit(m.id, 'time', ev.target.value)}
                                className="w-full input text-sm"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => applyEdit(m.id)} className="flex-1 py-1.5 rounded-lg bg-brand text-brand-dark text-xs font-semibold">Done</button>
                            <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg border border-brand-border text-xs text-brand-muted">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                              {m.court_number != null && (
                                <span className="text-[10px] font-bold bg-brand-soft text-brand-dark px-1.5 py-0.5 rounded">
                                  Court {m.court_number}
                                </span>
                              )}
                              {divName && (
                                <span className="text-[10px] text-brand-muted">{divName}</span>
                              )}
                              {m.round_number != null && (
                                <span className="text-[10px] text-brand-muted">Rd {m.round_number}</span>
                              )}
                              <span className="text-[10px] text-brand-muted capitalize">{m.match_stage?.replace(/_/g, ' ')}</span>
                            </div>
                            <p className="text-sm font-medium text-brand-dark truncate">
                              {t1} <span className="text-brand-muted font-normal">vs</span> {t2}
                            </p>
                          </div>
                          <button
                            onClick={() => startEdit(m)}
                            className="shrink-0 text-xs text-brand-active hover:underline"
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Unscheduled matches */}
      {unscheduled.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-brand-muted uppercase tracking-wide">Unscheduled</p>
          {unscheduled.map(m => {
            const isEditing = editingId === m.id
            const e = edits[m.id]
            const divName = divisionName(m.division_id)
            const t1 = teamLabel(m.team_1_registration_id, allRegs)
            const t2 = teamLabel(m.team_2_registration_id, allRegs)

            return (
              <div key={m.id} className={`bg-brand-surface border rounded-xl p-3 ${edits[m.id] ? 'border-amber-300' : 'border-brand-border'}`}>
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] font-medium text-brand-muted mb-0.5">Court</label>
                        <input type="number" min="1" value={e?.court_number ?? ''} onChange={ev => updateEdit(m.id, 'court_number', ev.target.value)} className="w-full input text-sm text-center" autoFocus />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-brand-muted mb-0.5">Date</label>
                        <input type="date" value={e?.date ?? ''} onChange={ev => updateEdit(m.id, 'date', ev.target.value)} className="w-full input text-sm" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-brand-muted mb-0.5">Time</label>
                        <input type="time" value={e?.time ?? ''} onChange={ev => updateEdit(m.id, 'time', ev.target.value)} className="w-full input text-sm" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => applyEdit(m.id)} className="flex-1 py-1.5 rounded-lg bg-brand text-brand-dark text-xs font-semibold">Done</button>
                      <button onClick={() => setEditingId(null)} className="px-3 py-1.5 rounded-lg border border-brand-border text-xs text-brand-muted">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                        {divName && <span className="text-[10px] text-brand-muted">{divName}</span>}
                        {m.round_number != null && <span className="text-[10px] text-brand-muted">Rd {m.round_number}</span>}
                        <span className="text-[10px] text-brand-muted capitalize">{m.match_stage?.replace(/_/g, ' ')}</span>
                      </div>
                      <p className="text-sm font-medium text-brand-dark truncate">
                        {t1} <span className="text-brand-muted font-normal">vs</span> {t2}
                      </p>
                    </div>
                    <button onClick={() => startEdit(m)} className="shrink-0 text-xs text-brand-active hover:underline">
                      Schedule
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
