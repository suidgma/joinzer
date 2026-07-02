import { orderByDependency, type SchedulableMatch } from '../scheduleGenerator'

export type RollingBlockInput = {
  court_numbers: number[]
  matches: SchedulableMatch[]
  // The block's first-round start time. The first match on each court is stamped with
  // it (so players know when to arrive); everything after rolls on with no clock time.
  blockDate?: string       // 'YYYY-MM-DD'
  startTime?: string       // 'HH:MM[:SS]'
  // Mirrors the timed scheduler's ordering knobs so the two agree on play order.
  keepDivisionsGrouped?: boolean
  divisionPriority?: Map<string, number>
  byPriority?: boolean
}

// Las Vegas is America/Los_Angeles (PDT, UTC-7) — same offset the timed scheduler uses.
function startIso(date?: string, time?: string): string | null {
  if (!date || !time) return null
  return `${date}T${time.slice(0, 5)}:00-07:00`
}

// Court optimization: never spread a block across more courts than can actually play
// at once. Peak concurrency = sum over divisions of that division's largest single
// round — matches sharing a (division, stage, round) have disjoint players by
// construction, so a 6-player round robin has 3 matches per round → 3 courts, even
// when the block offers more. Different divisions can run concurrently, so their peaks
// add.
function peakConcurrency(matches: SchedulableMatch[]): number {
  const roundCount = new Map<string, number>()
  for (const m of matches) {
    const k = `${m.division_id}|${m.match_stage ?? ''}|${m.round_number ?? 1}`
    roundCount.set(k, (roundCount.get(k) ?? 0) + 1)
  }
  const divPeak = new Map<string, number>()
  for (const [k, c] of roundCount) {
    const div = k.slice(0, k.indexOf('|'))
    if ((divPeak.get(div) ?? 0) < c) divPeak.set(div, c)
  }
  return Math.max(1, [...divPeak.values()].reduce((a, b) => a + b, 0))
}

/**
 * Rolling layout for ONE block. Orders matches by bracket dependency (reusing the
 * timed scheduler's `orderByDependency`), then distributes them round-robin across
 * the block's courts — but only across as many courts as can actually be filled at
 * once (see peakConcurrency), so a small division doesn't idle extra courts. With C
 * effective courts this yields the classic rolling layout, e.g. C=3 →
 *   Court 1: play-order 1, 4, 7, 10   Court 2: 2, 5, 8, …   Court 3: 3, 6, 9, …
 *
 * The first match on each court is stamped with the block start time; every later
 * match has no clock time. The tournament-wide Match # is assigned separately (in
 * this same dependency order) by the sequence assigner.
 *
 * Mutates court_number / scheduled_time / scheduled_end_time in place and returns the
 * matches in the dependency order used, so the caller can chain the tournament-wide
 * sequence deterministically across blocks.
 */
export function buildRollingSchedule(input: RollingBlockInput): SchedulableMatch[] {
  const allCourts = input.court_numbers.length > 0
    ? [...input.court_numbers].sort((a, b) => a - b)
    : [1]
  const effective = Math.min(allCourts.length, peakConcurrency(input.matches))
  const courts = allCourts.slice(0, Math.max(1, effective))

  const ordered = orderByDependency(input.matches, {
    keepDivisionsGrouped: input.keepDivisionsGrouped,
    divisionPriority: input.divisionPriority,
    byPriority: input.byPriority,
  })
  const start = startIso(input.blockDate, input.startTime)
  ordered.forEach((m, i) => {
    m.court_number = courts[i % courts.length]
    // Indices 0..courts.length-1 are the first match on each court (round-robin), so
    // they get the block start time; everything after rolls on with no clock time.
    m.scheduled_time = i < courts.length ? start : null
    m.scheduled_end_time = null
  })
  return ordered
}
