import type { SchedulableMatch } from '../scheduleGenerator'

// The set of scheduling methods a tournament can use. Extensible — a future
// 'hybrid' (round 1 timed, the rest rolling) slots in here and in the generation
// branch without touching call sites. See docs / the generate-schedule route.
export type SchedulingMethod = 'timed' | 'rolling'

export function isRolling(method: string | null | undefined): boolean {
  return method === 'rolling'
}

// A match the scheduler places. SchedulableMatch already carries court/time/
// sequence_number + the dependency fields, so it doubles as our plannable type.
export type PlannableMatch = SchedulableMatch
