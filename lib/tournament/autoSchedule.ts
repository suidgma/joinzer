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
}

export type CourtAssignment = {
  id: string
  court_number: number
  scheduled_time: string
}

// A booked match occupies [start_ms, start_ms + duration) on its court.
export type OccupiedSlot = { court_number: number; start_ms: number }

export function buildAutoSchedule(
  matches: AutoScheduleMatch[],
  startDate: string,           // "YYYY-MM-DD"
  startTime: string,           // "HH:MM"
  courtCount: number,
  durationMinutes: number,
  occupied: OccupiedSlot[] = [],
): CourtAssignment[] {
  const byRound = new Map<number, AutoScheduleMatch[]>()
  for (const m of matches) {
    const r = m.round_number ?? 1
    if (!byRound.has(r)) byRound.set(r, [])
    byRound.get(r)!.push(m)
  }
  const rounds = Array.from(byRound.entries())
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
