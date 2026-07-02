import type { SchedulableMatch } from '../scheduleGenerator'

// The tournament-wide, stable "Match #" (sequence_number = 1..N), assigned ONCE at
// schedule generation across every division/block — and deliberately NOT recomputed
// on a manual reschedule, so "Match 17" always refers to the same match.

/**
 * Timed: number matches by when/where they're played — (scheduled_time, court,
 * division, match_number). Mutates sequence_number in place; result is dense 1..N.
 */
export function assignSequenceTimed(matches: SchedulableMatch[]): void {
  const sorted = [...matches].sort((a, b) =>
    (a.scheduled_time ?? '~').localeCompare(b.scheduled_time ?? '~') ||
    (a.court_number ?? Infinity) - (b.court_number ?? Infinity) ||
    (a.division_id < b.division_id ? -1 : a.division_id > b.division_id ? 1 : 0) ||
    a.match_number - b.match_number,
  )
  sorted.forEach((m, i) => { m.sequence_number = i + 1 })
}

/**
 * Rolling: the caller passes matches already in dependency (play) order across all
 * blocks; number them 1..N in that order. Idempotent for a fixed ordering.
 */
export function assignSequenceInOrder(orderedMatches: SchedulableMatch[]): void {
  orderedMatches.forEach((m, i) => { m.sequence_number = i + 1 })
}
