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
  // Rotating doubles spreads its four players across these partner columns too —
  // they must be conflict-checked or a player gets booked into two matches at once.
  team_1_partner_registration_id?: string | null
  team_2_partner_registration_id?: string | null
  court_number?: number | null
  scheduled_time?: string | null
  scheduled_end_time?: string | null
  // Tournament-wide play-order "Match #" (assigned by the sequence assigner, both modes).
  sequence_number?: number | null
}

// Single-phase stages have NO inter-round dependency: round N+1 doesn't consume
// round N's results, so a player is only held back by the per-team rest gate, not
// by the whole previous round finishing. Folding round_number into their phase —
// the way elimination needs — would wrongly serialize the rounds, idling courts
// while a nearly-finished round blocks the next. So these collapse to one phase.
const SINGLE_PHASE_STAGES = new Set(['round_robin', 'pool_play'])

// Deepest losers-bracket round per division — fixes where the championship sits in
// the dependency order (right after the LB final).
function maxLbRoundByDivision(matches: SchedulableMatch[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of matches) {
    if (m.match_stage !== 'losers_bracket') continue
    const r = m.round_number ?? 1
    if ((out.get(m.division_id) ?? 0) < r) out.set(m.division_id, r)
  }
  return out
}

// Bracket-dependency depth of a match (see the note on scheduleBlockMatches):
//   WB / single-elim / playoffs round r → depth r-1   (round 1 is the first wave)
//   losers_bracket round r              → depth r       (LB R1 ‖ WB R2, …)
//   championship round r                → after the LB final
//   single-phase (round_robin/pool_play) → 0            (no inter-round dependency)
function makePhaseOf(matches: SchedulableMatch[]): (m: SchedulableMatch) => number {
  const maxLb = maxLbRoundByDivision(matches)
  return (m: SchedulableMatch): number => {
    const stage = m.match_stage ?? ''
    if (SINGLE_PHASE_STAGES.has(stage)) return 0
    const r = m.round_number ?? 1
    let depth: number
    if (stage === 'losers_bracket') depth = r
    else if (stage === 'championship') depth = (maxLb.get(m.division_id) ?? 0) + r
    else depth = r - 1
    return 1000 + depth
  }
}

// The dependency-respecting play order shared by the timed block packer and the
// rolling scheduler: earlier bracket phases first (so later rounds land later),
// then (when grouping) higher-priority/larger divisions, then match_number. Pure —
// returns a new array, doesn't mutate.
export function orderByDependency(
  matches: SchedulableMatch[],
  opts: { keepDivisionsGrouped?: boolean; divisionPriority?: Map<string, number>; byPriority?: boolean } = {},
): SchedulableMatch[] {
  const keepDivisionsGrouped = opts.keepDivisionsGrouped ?? true
  const byPriority = !!opts.byPriority && opts.divisionPriority != null
  const prio = (d: string) => opts.divisionPriority?.get(d) ?? 0
  const phaseOf = makePhaseOf(matches)
  const divCount = new Map<string, number>()
  for (const m of matches) divCount.set(m.division_id, (divCount.get(m.division_id) ?? 0) + 1)
  return [...matches].sort((a, b) => {
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

// The double-elim bracket-reset decider is created reactively when the first
// championship is scored, so the block packer never sees it. It plays right after
// that championship, on the same court, for the same length. Given the final's
// stored window (ISO with offset), returns the decider's window — or nulls when the
// final itself was never scheduled.
export function resetDeciderSlot(
  finalStart: string | null | undefined,
  finalEnd: string | null | undefined,
): { scheduled_time: string | null; scheduled_end_time: string | null } {
  if (!finalEnd) return { scheduled_time: finalStart ?? null, scheduled_end_time: null }
  // Pull/replace just the HH:MM, preserving the date + seconds + offset around it.
  const hm = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16))
  const at = (iso: string, minutes: number) => {
    const t = ((minutes % 1440) + 1440) % 1440
    const hh = String(Math.floor(t / 60)).padStart(2, '0')
    const mm = String(t % 60).padStart(2, '0')
    return `${iso.slice(0, 11)}${hh}:${mm}${iso.slice(16)}`
  }
  const scheduled_time = finalEnd            // decider starts when the final ends
  if (!finalStart) return { scheduled_time, scheduled_end_time: null }
  const duration = hm(finalEnd) - hm(finalStart)
  return { scheduled_time, scheduled_end_time: at(finalEnd, hm(finalEnd) + duration) }
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
  const courts = block.court_numbers.length > 0 ? [...block.court_numbers].sort((a, b) => a - b) : [1]
  const startMin = timeToMinutes(block.start_time)
  const endMin = timeToMinutes(block.end_time)
  const duration = settings.match_duration_minutes
  const perMatch = duration + settings.buffer_minutes
  const rest = settings.min_rest_minutes

  // Per-division match counts drive "largest division first" ordering.
  const divCount = new Map<string, number>()
  for (const m of matches) divCount.set(m.division_id, (divCount.get(m.division_id) ?? 0) + 1)

  // Bracket-dependency depth (shared with the rolling scheduler). See makePhaseOf.
  const phaseOf = makePhaseOf(matches)

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
  // later. Within a phase, schedule larger/higher-priority divisions first; grouping
  // keeps a division's matches clustered when courts allow. (Shared with rolling.)
  const ordered = orderByDependency(matches, {
    keepDivisionsGrouped,
    divisionPriority,
    byPriority: settings.schedule_by_priority,
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

    // Every player registration in this match — including rotating-doubles partners —
    // so a player is never booked into two matches at once (and rests between theirs).
    // Fixed doubles uses one team registration covering both partners; singles has one
    // per side; rotating doubles spreads four players across all four columns.
    const participants = [
      m.team_1_registration_id, m.team_1_partner_registration_id,
      m.team_2_registration_id, m.team_2_partner_registration_id,
    ].filter(Boolean) as string[]
    const restReady = participants.reduce(
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
    for (const t of participants) teamLastEnd.set(t, end)
    if (divPhaseEnd.get(div)! < end) divPhaseEnd.set(div, end)
    let dc = divCourts.get(div)
    if (!dc) { dc = new Set(); divCourts.set(div, dc) }
    dc.add(bestCourt)
    if (end > endMin) overflow++
  }

  return { overflowCount: overflow }
}
