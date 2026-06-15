import type { ScheduleSettings } from '@/lib/types'
import { timeToMinutes } from './scheduleEstimates'

// Greedy within-block scheduler. Assigns a court + start time to each match in a
// block, spreading matches across the block's courts and giving each team a rest
// gap between its matches. Pure: it mutates court_number/scheduled_time on the
// passed rows and reports how many spill past the block's end time.

export type SchedulableMatch = {
  division_id: string
  round_number: number | null
  match_number: number
  team_1_registration_id?: string | null
  team_2_registration_id?: string | null
  court_number?: number | null
  scheduled_time?: string | null
}

export type BlockWindow = {
  block_date: string      // 'YYYY-MM-DD'
  start_time: string      // 'HH:MM[:SS]'
  end_time: string
  court_numbers: number[]
}

// Las Vegas is America/Los_Angeles; June is PDT (UTC-7). Matches the offset used
// by the existing per-division auto-scheduler so times render consistently.
function toIso(date: string, minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return `${date}T${hh}:${mm}:00-07:00`
}

export function scheduleBlockMatches(
  block: BlockWindow,
  matches: SchedulableMatch[],
  settings: ScheduleSettings,
  keepDivisionsGrouped = true,
  shareCourts = true,
): { overflowCount: number } {
  const courts = block.court_numbers.length > 0 ? [...block.court_numbers].sort((a, b) => a - b) : [1]
  const startMin = timeToMinutes(block.start_time)
  const endMin = timeToMinutes(block.end_time)
  const duration = settings.match_duration_minutes
  const perMatch = duration + settings.buffer_minutes
  const rest = settings.min_rest_minutes

  // Per-division match counts drive "largest division first" ordering.
  const divCount = new Map<string, number>()
  for (const m of matches) divCount.set(m.division_id, (divCount.get(m.division_id) ?? 0) + 1)

  // When courts can't be shared, give each division its own court subset
  // (round-robin split, largest divisions first). If there are more divisions
  // than courts, the leftovers fall back to all courts — the builder warns about
  // that case up front.
  const allowedCourts = new Map<string, number[]>()
  if (!shareCourts) {
    const divIds = Array.from(divCount.keys()).sort((a, b) => (divCount.get(b)! - divCount.get(a)!) || (a < b ? -1 : 1))
    for (const d of divIds) allowedCourts.set(d, [])
    courts.forEach((c, idx) => allowedCourts.get(divIds[idx % divIds.length])!.push(c))
    for (const d of divIds) if (allowedCourts.get(d)!.length === 0) allowedCourts.set(d, courts)
  }

  // Earlier rounds first so later rounds (which depend on winners) land later.
  // Within a round, schedule larger divisions first; grouping keeps a division's
  // matches clustered when courts allow.
  const ordered = [...matches].sort((a, b) => {
    const ra = a.round_number ?? 1, rb = b.round_number ?? 1
    if (ra !== rb) return ra - rb
    if (keepDivisionsGrouped && a.division_id !== b.division_id) {
      const ca = divCount.get(a.division_id) ?? 0, cb = divCount.get(b.division_id) ?? 0
      if (ca !== cb) return cb - ca               // largest division first
      return a.division_id < b.division_id ? -1 : 1
    }
    return a.match_number - b.match_number
  })

  const courtFree = new Map<number, number>(courts.map(c => [c, startMin]))
  const teamLastEnd = new Map<string, number>()
  let overflow = 0

  for (const m of ordered) {
    const teams = [m.team_1_registration_id, m.team_2_registration_id].filter(Boolean) as string[]
    // A team can't start its next match until it has rested.
    const restReady = teams.reduce(
      (mx, t) => Math.max(mx, (teamLastEnd.get(t) ?? -Infinity) + rest),
      startMin,
    )
    // Pick the court that lets this match start earliest (restricted to the
    // division's own courts when court-sharing is off).
    const usable = shareCourts ? courts : (allowedCourts.get(m.division_id) ?? courts)
    let bestCourt = usable[0]
    let bestStart = Infinity
    for (const c of usable) {
      const s = Math.max(courtFree.get(c)!, restReady)
      if (s < bestStart) { bestStart = s; bestCourt = c }
    }

    m.court_number = bestCourt
    m.scheduled_time = toIso(block.block_date, bestStart)
    courtFree.set(bestCourt, bestStart + perMatch)
    for (const t of teams) teamLastEnd.set(t, bestStart + duration)
    if (bestStart + duration > endMin) overflow++
  }

  return { overflowCount: overflow }
}
