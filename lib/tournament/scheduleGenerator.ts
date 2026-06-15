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
): { overflowCount: number } {
  const courts = block.court_numbers.length > 0 ? [...block.court_numbers].sort((a, b) => a - b) : [1]
  const startMin = timeToMinutes(block.start_time)
  const endMin = timeToMinutes(block.end_time)
  const duration = settings.match_duration_minutes
  const perMatch = duration + settings.buffer_minutes
  const rest = settings.min_rest_minutes

  // Earlier rounds first so later rounds (which depend on winners) land later.
  // Grouping keeps a division's matches clustered when courts allow.
  const ordered = [...matches].sort((a, b) => {
    const ra = a.round_number ?? 1, rb = b.round_number ?? 1
    if (ra !== rb) return ra - rb
    if (keepDivisionsGrouped && a.division_id !== b.division_id) {
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
    // Pick the court that lets this match start earliest.
    let bestCourt = courts[0]
    let bestStart = Infinity
    for (const c of courts) {
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
