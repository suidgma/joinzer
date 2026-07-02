import { orderByDependency, type SchedulableMatch } from '../scheduleGenerator'

export type RollingBlockInput = {
  court_numbers: number[]
  matches: SchedulableMatch[]
  // Mirrors the timed scheduler's ordering knobs so the two agree on play order.
  keepDivisionsGrouped?: boolean
  divisionPriority?: Map<string, number>
  byPriority?: boolean
}

/**
 * Rolling layout for ONE block. Orders matches by bracket dependency (reusing the
 * timed scheduler's `orderByDependency`), then distributes them round-robin across
 * the block's courts — ordered index i → courts[i % C] — and clears all times.
 *
 * With C courts this yields the classic rolling layout, e.g. C=6 →
 *   Court 1: play-order 1, 7, 13, 19   Court 2: 2, 8, 14, 20   …
 * (the tournament-wide Match # is assigned separately by the sequence assigner, in
 * this same dependency order, so the numbers line up with the courts.)
 *
 * Mutates court_number / scheduled_time / scheduled_end_time in place and returns
 * the matches in the dependency order used, so the caller can chain the
 * tournament-wide sequence deterministically across blocks.
 */
export function buildRollingSchedule(input: RollingBlockInput): SchedulableMatch[] {
  const courts = input.court_numbers.length > 0
    ? [...input.court_numbers].sort((a, b) => a - b)
    : [1]
  const ordered = orderByDependency(input.matches, {
    keepDivisionsGrouped: input.keepDivisionsGrouped,
    divisionPriority: input.divisionPriority,
    byPriority: input.byPriority,
  })
  ordered.forEach((m, i) => {
    m.court_number = courts[i % courts.length]
    m.scheduled_time = null
    m.scheduled_end_time = null
  })
  return ordered
}
