'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Wand2 } from 'lucide-react'

// One-click "Generate Full Tournament" — the simple-mode counterpart to the
// Advanced Schedule Builder. Builds brackets for every division (via generate-all)
// and packs them into courts + time slots in a single action, saving immediately.
// For block-by-block control, organizers use the Schedule Builder instead.

type Match = {
  id: string
  division_id: string
  round_number: number | null
  match_number: number
  match_stage: string
  court_number: number | null
  scheduled_time: string | null
  team_1_registration_id: string | null
  team_2_registration_id: string | null
}

type TournamentDay = { date: string; start_time: string; end_time: string }

type Props = {
  tournamentId: string
  initialMatches: Match[]
  tournamentDate: string        // YYYY-MM-DD
  defaultStartTime: string      // HH:MM
  defaultEndTime: string | null // HH:MM or null
  additionalDays?: TournamentDay[]
  locationCourtCount?: number | null
  locationName?: string | null
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

// Place each match into the earliest time slot where neither team is already
// booked and a court is free. Pure: returns the assignments without mutating input.
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
  const numCourts = courts.length
  const startMin = toMinutes(startTime)

  // Sort: stage priority → round → match_number.
  const stagePriority: Record<string, number> = {
    pool_play: 0, round_robin: 0,
    winners_bracket: 1, single_elimination: 1,
    losers_bracket: 2, playoffs: 3, championship: 4,
  }
  const sorted = [...matches].sort((a, b) => {
    const sa = stagePriority[a.match_stage] ?? 1
    const sb = stagePriority[b.match_stage] ?? 1
    if (sa !== sb) return sa - sb
    const ra = a.round_number ?? 999
    const rb = b.round_number ?? 999
    if (ra !== rb) return ra - rb
    return a.match_number - b.match_number
  })

  const waveSlots: Match[][] = []
  const result: { id: string; court_number: number; scheduled_time: string }[] = []

  for (const m of sorted) {
    const p1 = m.team_1_registration_id
    const p2 = m.team_2_registration_id
    // Bye matches (p2 === null) are auto-completed — skip court/time assignment.
    if (!p2) continue

    // Earliest wave with a free court and no player conflict.
    let wave = 0
    while (true) {
      const slot = waveSlots[wave] ?? []
      const courtFree = slot.length < numCourts
      const playerBusy = slot.some(existing =>
        (p1 && (existing.team_1_registration_id === p1 || existing.team_2_registration_id === p1)) ||
        (p2 && (existing.team_1_registration_id === p2 || existing.team_2_registration_id === p2))
      )
      if (courtFree && !playerBusy) break
      wave++
    }

    if (!waveSlots[wave]) waveSlots[wave] = []
    const courtIndex = waveSlots[wave].length
    waveSlots[wave].push(m)

    const timeMin = startMin + wave * matchDuration
    result.push({
      id: m.id,
      court_number: courts[courtIndex],
      scheduled_time: `${date}T${fromMinutes(timeMin)}:00-07:00`,
    })
  }

  return result
}

export default function ScheduleGenerator({
  tournamentId, initialMatches, tournamentDate, defaultStartTime, defaultEndTime,
  additionalDays, locationCourtCount, locationName,
}: Props) {
  const router = useRouter()
  const [matches, setMatches] = useState<Match[]>(initialMatches)
  const [showGenerator, setShowGenerator] = useState(false)

  const [genDate, setGenDate] = useState(tournamentDate)
  const [genStartTime, setGenStartTime] = useState(defaultStartTime || '08:00')
  const [genEndTime, setGenEndTime] = useState(defaultEndTime || '17:00')
  const [genDuration, setGenDuration] = useState(45)
  const [genFirstCourt, setGenFirstCourt] = useState(1)
  const [genLastCourt, setGenLastCourt] = useState(locationCourtCount ?? 24)

  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [generateResult, setGenerateResult] = useState<{ divisionId: string; name: string; matchCount: number; skipped?: string }[] | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const playableMatches = useMemo(
    () => matches.filter(m => m.team_1_registration_id || m.team_2_registration_id),
    [matches]
  )

  const numCourts = Math.max(1, genLastCourt - genFirstCourt + 1)
  const realMatches = playableMatches.filter(m => m.team_2_registration_id)
  const numWaves = Math.ceil(realMatches.length / numCourts)
  const estimatedEndMin = toMinutes(genStartTime) + numWaves * genDuration
  const estimatedEndTime = fromMinutes(estimatedEndMin)
  const overrun = estimatedEndMin > toMinutes(genEndTime)
  const hasMatches = matches.length > 0

  async function persistScheduleUpdates(
    updates: { id: string; court_number: number; scheduled_time: string }[]
  ): Promise<boolean> {
    if (updates.length === 0) return true
    const res = await fetch(`/api/tournaments/${tournamentId}/schedule`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setSaveError(data.error ?? 'Failed to save generated schedule')
      return false
    }
    return true
  }

  // Generate brackets for all divisions, then pack + save in one action.
  async function handleGenerateTournament() {
    setGenerating(true)
    setGenerateError(null)
    setSaveError(null)
    setGenerateResult(null)

    let allMatches = [...matches]
    if (allMatches.length === 0) {
      const res = await fetch(`/api/tournaments/${tournamentId}/generate-all`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setGenerateError(data.error ?? 'Failed to generate brackets')
        setGenerating(false)
        return
      }
      const newMatches = (data.matches ?? []) as Match[]
      allMatches = [...allMatches, ...newMatches]
      setMatches(allMatches)
      setGenerateResult(data.divisions)
    }

    const playable = allMatches.filter(m => m.team_1_registration_id || m.team_2_registration_id)
    const generated = generateSchedule(playable, genDate, genStartTime, genDuration, genFirstCourt, genLastCourt)
    const genMap = new Map(generated.map(g => [g.id, g]))
    setMatches(allMatches.map(m => {
      const g = genMap.get(m.id)
      return g ? { ...m, court_number: g.court_number, scheduled_time: g.scheduled_time } : m
    }))

    const ok = await persistScheduleUpdates(generated)
    if (ok) setSaveSuccess(true)
    setShowGenerator(false)
    setGenerating(false)
    router.refresh()
  }

  // Re-pack existing brackets into fresh court/time slots.
  async function handleReschedule() {
    setGenerating(true)
    setSaveError(null)
    const generated = generateSchedule(playableMatches, genDate, genStartTime, genDuration, genFirstCourt, genLastCourt)
    const genMap = new Map(generated.map(g => [g.id, g]))
    setMatches(matches.map(m => {
      const g = genMap.get(m.id)
      return g ? { ...m, court_number: g.court_number, scheduled_time: g.scheduled_time } : m
    }))
    const ok = await persistScheduleUpdates(generated)
    if (ok) setSaveSuccess(true)
    setShowGenerator(false)
    setGenerating(false)
    router.refresh()
  }

  const days: TournamentDay[] = [
    { date: tournamentDate, start_time: defaultStartTime || '08:00', end_time: defaultEndTime || '17:00' },
    ...(additionalDays ?? []),
  ]

  return (
    <div className="bg-white border border-brand-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-sm font-bold text-brand-dark flex items-center gap-1.5">
            <Wand2 size={15} className="text-brand-muted" />
            {hasMatches ? 'Tournament Schedule' : 'Generate Full Tournament'}
          </h2>
          <p className="text-xs text-brand-muted mt-0.5">
            {hasMatches
              ? 'Brackets are generated. Re-pack courts + times, or fine-tune in the Schedule Builder.'
              : 'One click builds every division’s bracket and assigns courts + times.'}
          </p>
        </div>
        <button
          onClick={() => setShowGenerator(v => !v)}
          className="shrink-0 text-sm font-medium text-brand-active hover:underline"
        >
          {showGenerator ? 'Close' : hasMatches ? '⚙ Reschedule' : '⚙ Generate'}
        </button>
      </div>

      {showGenerator && (
        <div className="border-t border-brand-border pt-3 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {(additionalDays ?? []).length > 0 && (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-brand-muted mb-1">Day</label>
                <div className="flex gap-2 flex-wrap">
                  {days.map((day, i) => {
                    const isActive = genDate === day.date
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => { setGenDate(day.date); setGenStartTime(day.start_time); setGenEndTime(day.end_time) }}
                        className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${isActive ? 'bg-brand border-brand text-brand-dark' : 'bg-white border-brand-border text-brand-muted hover:text-brand-dark'}`}
                      >
                        Day {i + 1}
                        <span className="ml-1 font-normal opacity-70">{new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
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
              <label className="block text-xs font-medium text-brand-muted mb-1">
                Courts{locationName ? ` (${locationName})` : ''}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="1" max="100"
                  value={genFirstCourt}
                  onChange={e => setGenFirstCourt(parseInt(e.target.value) || 1)}
                  className="w-full input text-center"
                  placeholder="First"
                />
                <span className="text-brand-muted text-sm flex-shrink-0">–</span>
                <input
                  type="number" min="1" max="100"
                  value={genLastCourt}
                  onChange={e => setGenLastCourt(parseInt(e.target.value) || locationCourtCount || 24)}
                  className="w-full input text-center"
                  placeholder="Last"
                />
              </div>
              <p className="text-xs text-brand-muted mt-1">
                {numCourts} court{numCourts !== 1 ? 's' : ''} · {numWaves > 0 ? `${numWaves} time slot${numWaves !== 1 ? 's' : ''}` : 'brackets generate on confirm'}
              </p>
            </div>
          </div>

          {(hasMatches || numWaves > 0) && (
            <div className={`rounded-xl px-3 py-2.5 text-xs ${overrun ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-brand-soft border border-brand-border text-brand-body'}`}>
              {overrun
                ? `⚠ Estimated finish ${formatTime12(estimatedEndTime)} exceeds your end time of ${formatTime12(genEndTime)}. Add more courts or extend end time.`
                : `Estimated finish: ${formatTime12(estimatedEndTime)}`}
            </div>
          )}

          {generateError && <p className="text-xs text-red-600">{generateError}</p>}

          <button
            onClick={hasMatches ? handleReschedule : handleGenerateTournament}
            disabled={generating}
            className="w-full py-2.5 rounded-xl bg-brand text-brand-dark text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 transition-colors"
          >
            {generating ? 'Generating…' : hasMatches ? 'Regenerate Schedule' : 'Generate Full Tournament'}
          </button>
          <p className="text-xs text-brand-muted text-center">
            Saves automatically and goes live. You can reschedule individual matches afterward.
          </p>
        </div>
      )}

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

      {saveError && <p className="text-xs text-red-600">{saveError}</p>}
      {saveSuccess && <p className="text-xs text-green-600 font-medium">✓ Schedule saved and live</p>}
    </div>
  )
}
