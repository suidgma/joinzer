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
  match_stage?: string | null
  team_1_registration_id?: string | null
  team_2_registration_id?: string | null
  court_number?: number | null
  scheduled_time?: string | null
  scheduled_end_time?: string | null
}

// Bracket dependency phases. A match can't start until every earlier-phase match
// in its OWN division has finished: round N feeds round N+1, and in double elim
// the losers bracket is fed by the winners bracket and the championship by both.
// round_robin / pool play are a single phase (no inter-round dependency).
const STAGE_PRIORITY: Record<string, number> = {
  pool_play: 0, round_robin: 0,
  single_elimination: 1, winners_bracket: 1,
  losers_bracket: 2, playoffs: 3, consolation: 3, championship: 4,
}
// Monotonic key so, within a division, a lower (stage, round) always sorts and
// schedules before a higher one — later-round "winner-of TBD" matches included.
function phaseOf(m: SchedulableMatch): number {
  return (STAGE_PRIORITY[m.match_stage ?? ''] ?? 1) * 1000 + (m.round_number ?? 1)
}

export type BlockWindow = {
  block_date: string      // 'YYYY-MM-DD'
  start_time: string      // 'HH:MM[:SS]'
  end_time: string
  court_numbers: number[]
}

// Las Vegas is America/Los_Angeles; June is PDT (UTC-7). Matches the offset used
// by the existing per-division auto-scheduler so times render consistently.
// `minutes` may exceed 1440 when a block's matches overflow past midnight — roll
// the date forward and wrap the clock so we never emit an invalid hour like
// "24:35" (which Postgres rejects, failing the whole insert).
function toIso(date: string, minutes: number): string {
  const dayOffset = Math.floor(minutes / 1440)
  const mins = minutes - dayOffset * 1440
  const hh = String(Math.floor(mins / 60)).padStart(2, '0')
  const mm = String(mins % 60).padStart(2, '0')
  let isoDate = date
  if (dayOffset !== 0) {
    const [y, m, d] = date.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d + dayOffset))
    isoDate = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
  }
  return `${isoDate}T${hh}:${mm}:00-07:00`
}

export function scheduleBlockMatches(
  block: BlockWindow,
  matches: SchedulableMatch[],
  settings: ScheduleSettings,
  keepDivisionsGrouped = true,
  shareCourts = true,
  divisionPriority?: Map<string, number>,
  // Cross-block court occupancy, keyed `${date}|${court}` → next-free minute.
  // When several blocks share physical courts at overlapping times, threading
  // one map through every block keeps a court from being double-booked.
  courtReservations?: Map<string, number>,
): { overflowCount: number } {
  // Higher organizer-set priority schedules a division's matches first.
  const byPriority = settings.schedule_by_priority && divisionPriority != null
  const prio = (d: string) => divisionPriority?.get(d) ?? 0
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

  // Earlier phases first so later rounds (which depend on earlier results) land
  // later. Within a phase, schedule larger divisions first; grouping keeps a
  // division's matches clustered when courts allow.
  const ordered = [...matches].sort((a, b) => {
    const pa = phaseOf(a), pb = phaseOf(b)
    if (pa !== pb) return pa - pb
    if (keepDivisionsGrouped && a.division_id !== b.division_id) {
      if (byPriority) {
        const qa = prio(a.division_id), qb = prio(b.division_id)
        if (qa !== qb) return qb - qa             // higher priority first
      }
      const ca = divCount.get(a.division_id) ?? 0, cb = divCount.get(b.division_id) ?? 0
      if (ca !== cb) return cb - ca               // then largest division first
      return a.division_id < b.division_id ? -1 : 1
    }
    return a.match_number - b.match_number
  })

  // Seed each court's first-free time from any cross-block reservation so this
  // block schedules around courts already claimed by other blocks.
  const resKey = (c: number) => `${block.block_date}|${c}`
  const courtFree = new Map<number, number>(
    courts.map(c => [c, Math.max(startMin, courtReservations?.get(resKey(c)) ?? startMin)])
  )
  const teamLastEnd = new Map<string, number>()
  // Per-division dependency floor: no match in a division may start before the
  // last match of that division's previous phase has ended. This is what stops a
  // later-round "winner-of TBD" match (which has no team IDs to rest-gate it)
  // from being packed into the same slot as the matches that feed it.
  const divPhase = new Map<string, number>()       // current phase being placed
  const divFloor = new Map<string, number>()        // earliest start for that phase
  const divPhaseEnd = new Map<string, number>()     // latest end seen within it
  const divCourts = new Map<string, Set<number>>()  // courts each division has used
  let overflow = 0

  for (const m of ordered) {
    const div = m.division_id
    const p = phaseOf(m)
    if (!divPhase.has(div)) {
      divPhase.set(div, p); divFloor.set(div, startMin); divPhaseEnd.set(div, startMin)
    } else if (p > divPhase.get(div)!) {
      // Advanced to a new round/stage for this division — it can't begin until the
      // previous phase has fully finished. (ordered is phase-monotonic per division.)
      const floor = divPhaseEnd.get(div)!
      divPhase.set(div, p); divFloor.set(div, floor); divPhaseEnd.set(div, floor)
    }
    const phaseFloor = divFloor.get(div)!

    const teams = [m.team_1_registration_id, m.team_2_registration_id].filter(Boolean) as string[]
    // A team can't start its next match until it has rested.
    const restReady = teams.reduce(
      (mx, t) => Math.max(mx, (teamLastEnd.get(t) ?? -Infinity) + rest),
      startMin,
    )
    const earliest = Math.max(restReady, phaseFloor)
    // Pick the court that lets this match start earliest (restricted to the
    // division's own courts when court-sharing is off).
    const usable = shareCourts ? courts : (allowedCourts.get(m.division_id) ?? courts)
    let bestCourt = usable[0]
    let bestStart = Infinity
    for (const c of usable) {
      const s = Math.max(courtFree.get(c)!, earliest)
      if (s < bestStart) { bestStart = s; bestCourt = c }
    }

    // Court locality: keep a division on the courts it's already playing on
    // instead of spilling onto a fresh court just to skip the turnaround buffer.
    // Reuse an own court when it frees within `buffer_minutes` of the earliest
    // option — so a 4-team division's final stays on Court 1/2, not Court 3.
    if (keepDivisionsGrouped) {
      const used = divCourts.get(div)
      if (used && used.size > 0) {
        let ownCourt = -1
        let ownStart = Infinity
        for (const c of usable) {
          if (!used.has(c)) continue
          const s = Math.max(courtFree.get(c)!, earliest)
          if (s < ownStart) { ownStart = s; ownCourt = c }
        }
        if (ownCourt !== -1 && ownStart <= bestStart + settings.buffer_minutes) {
          bestCourt = ownCourt
          bestStart = ownStart
        }
      }
    }

    m.court_number = bestCourt
    m.scheduled_time = toIso(block.block_date, bestStart)
    m.scheduled_end_time = toIso(block.block_date, bestStart + duration)
    courtFree.set(bestCourt, bestStart + perMatch)
    courtReservations?.set(resKey(bestCourt), bestStart + perMatch)
    const end = bestStart + duration
    for (const t of teams) teamLastEnd.set(t, end)
    if (divPhaseEnd.get(div)! < end) divPhaseEnd.set(div, end)
    let dc = divCourts.get(div)
    if (!dc) { dc = new Set(); divCourts.set(div, dc) }
    dc.add(bestCourt)
    if (end > endMin) overflow++
  }

  return { overflowCount: overflow }
}
