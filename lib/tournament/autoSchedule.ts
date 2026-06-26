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

// In a double-elimination bracket (and the round-robin "double-elim final" playoff)
// round_number resets per stage, so grouping by round alone puts the Championship
// (round 1) at the same slot as the first-round matches — even though it can't start
// until the WB Final and LB Final finish. This maps each match to a dependency LEVEL:
// the length of the longest chain of feeder matches that must complete before it can
// be played. Later stages float to later slots. Single-stage brackets (round robin,
// pool play, single elimination) have no cross-stage dependency, so they fall back to
// round_number and schedule exactly as before.
function computeBracketLevels(matches: AutoScheduleMatch[]): Map<string, number> {
  const stages = new Set(matches.map(m => m.match_stage).filter(Boolean) as string[])
  const hasLB = stages.has('losers_bracket')
  const hasChamp = stages.has('championship')
  const levels = new Map<string, number>()

  // No cross-stage dependencies → round_number ordering is already correct.
  if (!hasLB && !hasChamp) {
    for (const m of matches) levels.set(m.id, m.round_number ?? 1)
    return levels
  }

  const primaryStage = stages.has('winners_bracket') ? 'winners_bracket'
    : stages.has('single_elimination') ? 'single_elimination'
    : stages.has('playoffs') ? 'playoffs'
    : null
  const maxRoundOf = (stage: string) =>
    matches.reduce((mx, m) => (m.match_stage === stage ? Math.max(mx, m.round_number ?? 1) : mx), 0)
  const W = primaryStage ? maxRoundOf(primaryStage) : 0
  const L = maxRoundOf('losers_bracket')

  // Winners/primary round r is played at level r.
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

  // The Championship follows the last WB round and (if any) the last LB round.
  const champBase = Math.max(W, hasLB ? lbLevel(L) : 0) + 1

  for (const m of matches) {
    const r = m.round_number ?? 1
    if (m.match_stage === 'championship') levels.set(m.id, champBase + (r - 1))
    else if (m.match_stage === 'losers_bracket') levels.set(m.id, lbLevel(r))
    else levels.set(m.id, r)
  }
  return levels
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
