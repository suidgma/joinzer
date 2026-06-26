// Auto-scheduler for the per-division "Generate Matches" flow. Assigns each match
// a court + start time, staggering later rounds after earlier ones.
//
// Crucially it takes `occupied` — the (court, time) cells already booked by OTHER
// divisions in the same tournament — and never reuses one, so generating divisions
// one at a time no longer stacks every division's round 1 onto court 1 at the start
// time (which double-booked courts). With an empty `occupied` it behaves exactly as
// the original per-division packer: courts 1..N from `startTime`, round by round.

export type AutoScheduleMatch = {
  id: string
  round_number: number | null
  match_number: number
  // Optional — when present (elimination brackets) it lets the scheduler order
  // across stages instead of by raw round_number, which resets per stage.
  match_stage?: string | null
}

export type CourtAssignment = {
  id: string
  court_number: number
  scheduled_time: string
}

// A booked match occupies [start_ms, start_ms + duration) on its court.
export type OccupiedSlot = { court_number: number; start_ms: number }

// Base play (round robin, pools) whose results seed a playoff — these run first.
const BASE_STAGES = new Set(['round_robin', 'pool_play'])

// Maps each match to a dependency LEVEL — the length of the longest chain of feeder
// matches that must finish before it can be played — so the scheduler groups by real
// dependency rather than raw round_number (which resets per stage). Two reasons this
// matters: (1) in a double-elim bracket the Championship (round 1) can't share a slot
// with the first round; (2) when a "+ playoffs" division's base play AND its playoff
// bracket are scheduled together, the whole playoff bracket must float AFTER all base
// play, not interleave with it. Base stages take levels 1..baseMax by round; playoff
// stages take baseMax + their internal bracket level. Single-stage brackets with no
// base fall back to round_number and schedule exactly as before.
function computeBracketLevels(matches: AutoScheduleMatch[]): Map<string, number> {
  const levels = new Map<string, number>()

  // Base play occupies levels 1..baseMax by round number.
  let baseMax = 0
  for (const m of matches) {
    if (m.match_stage && BASE_STAGES.has(m.match_stage)) {
      const r = m.round_number ?? 1
      levels.set(m.id, r)
      if (r > baseMax) baseMax = r
    }
  }

  // Playoff / elimination stages: bracket-dependency level, floored after base play.
  const playoff = matches.filter(m => m.match_stage && !BASE_STAGES.has(m.match_stage))
  const pStages = new Set(playoff.map(m => m.match_stage as string))
  const hasLB = pStages.has('losers_bracket')
  const primaryStage = pStages.has('winners_bracket') ? 'winners_bracket'
    : pStages.has('single_elimination') ? 'single_elimination'
    : pStages.has('playoffs') ? 'playoffs'
    : null
  const maxRoundOf = (stage: string) =>
    playoff.reduce((mx, m) => (m.match_stage === stage ? Math.max(mx, m.round_number ?? 1) : mx), 0)
  const W = primaryStage ? maxRoundOf(primaryStage) : 0
  const L = maxRoundOf('losers_bracket')

  // Losers-bracket round r: minor rounds (r === 1 and even r) take the loser dropping
  // from WB round r/2+1 and so wait for both that WB round and the prior LB round;
  // major rounds (odd ≥ 3) wait only for the prior LB round.
  const lbMemo = new Map<number, number>()
  const lbLevel = (r: number): number => {
    if (r <= 0) return 0
    const cached = lbMemo.get(r)
    if (cached != null) return cached
    let lvl: number
    if (r === 1) lvl = 1 + 1
    else if (r % 2 === 0) lvl = Math.max(lbLevel(r - 1), r / 2 + 1) + 1
    else lvl = lbLevel(r - 1) + 1
    lbMemo.set(r, lvl)
    return lvl
  }
  // The Championship follows the last WB/primary round and (if any) the last LB round.
  const champBase = Math.max(W, hasLB ? lbLevel(L) : 0) + 1

  for (const m of playoff) {
    const r = m.round_number ?? 1
    let dep: number
    if (m.match_stage === 'championship') dep = champBase + (r - 1)
    else if (m.match_stage === 'losers_bracket') dep = lbLevel(r)
    else dep = r // primary: winners_bracket / single_elimination / playoffs
    levels.set(m.id, baseMax + dep)
  }

  // Anything without a recognized stage falls back to round_number.
  for (const m of matches) if (!levels.has(m.id)) levels.set(m.id, m.round_number ?? 1)
  return levels
}

/**
 * The "HH:MM" at which a follow-on stage (e.g. playoffs) should start so it doesn't
 * overlap already-scheduled play: the latest start among `scheduledTimes` plus one
 * round (the smallest gap between scheduled rounds, else 60 min). Falls back to
 * `fallbackHHMM` when nothing is scheduled yet. Reads the stored -07:00 wall-clock
 * by lifting HH:MM straight from the ISO string, so it's timezone-stable.
 */
export function nextStageStart(scheduledTimes: (string | null | undefined)[], fallbackHHMM: string): string {
  const mins = scheduledTimes
    .map(t => t?.match(/T(\d{2}):(\d{2})/))
    .filter((x): x is RegExpMatchArray => !!x)
    .map(x => Number(x[1]) * 60 + Number(x[2]))
  if (!mins.length) return fallbackHHMM
  const sorted = Array.from(new Set(mins)).sort((a, b) => a - b)
  const gaps = sorted.slice(1).map((m, i) => m - sorted[i]).filter(g => g > 0)
  const roundGap = gaps.length ? Math.min(...gaps) : 60
  const floorMin = sorted[sorted.length - 1] + roundGap
  return `${String(Math.floor(floorMin / 60)).padStart(2, '0')}:${String(floorMin % 60).padStart(2, '0')}`
}

export function buildAutoSchedule(
  matches: AutoScheduleMatch[],
  startDate: string,           // "YYYY-MM-DD"
  startTime: string,           // "HH:MM"
  courtCount: number,
  durationMinutes: number,
  occupied: OccupiedSlot[] = [],
): CourtAssignment[] {
  // Group by dependency level (not raw round_number) so a double-elim Championship
  // lands after its feeders instead of alongside the first round. Matches at the same
  // level are independent and may share a time slot across different courts.
  const levelOf = computeBracketLevels(matches)
  const byLevel = new Map<number, AutoScheduleMatch[]>()
  for (const m of matches) {
    const lvl = levelOf.get(m.id) ?? (m.round_number ?? 1)
    if (!byLevel.has(lvl)) byLevel.set(lvl, [])
    byLevel.get(lvl)!.push(m)
  }
  const rounds = Array.from(byLevel.entries())
    .sort(([a], [b]) => a - b)
    .map(([, ms]) => ms.sort((a, b) => a.match_number - b.match_number))

  const [h, min] = startTime.split(':').map(Number)
  const baseMin = h * 60 + (min || 0)
  const durMs = durationMinutes * 60_000

  // Two matches on one court conflict when their starts are less than one match
  // duration apart. `taken` accumulates other divisions' slots plus everything we
  // assign here, so within and across divisions a court is never double-booked.
  const taken: OccupiedSlot[] = [...occupied]
  const courtFree = (court: number, startMs: number) =>
    !taken.some(t => t.court_number === court && Math.abs(t.start_ms - startMs) < durMs)

  const isoFor = (slotMin: number) => {
    const hh = String(Math.floor(slotMin / 60)).padStart(2, '0')
    const mm = String(slotMin % 60).padStart(2, '0')
    return `${startDate}T${hh}:${mm}:00-07:00`
  }

  const result: CourtAssignment[] = []
  let roundFloorMin = baseMin

  for (const roundMatches of rounds) {
    let maxSlotMin = roundFloorMin
    for (const m of roundMatches) {
      // Walk forward in time from this round's floor until a court is free.
      let slotMin = roundFloorMin
      for (;;) {
        const iso = isoFor(slotMin)
        const startMs = Date.parse(iso)
        let court = 0
        for (let c = 1; c <= courtCount; c++) {
          if (courtFree(c, startMs)) { court = c; break }
        }
        if (court > 0) {
          result.push({ id: m.id, court_number: court, scheduled_time: iso })
          taken.push({ court_number: court, start_ms: startMs })
          if (slotMin > maxSlotMin) maxSlotMin = slotMin
          break
        }
        slotMin += durationMinutes
      }
    }
    // A later round can't start until the latest slot this round used has cleared.
    roundFloorMin = maxSlotMin + durationMinutes
  }
  return result
}
