// Pure deadline-phase logic for the flex-league cron. Kept free of imports so it is
// directly unit-testable (vitest has no path-alias config).

// The reminder fires anywhere inside this window rather than on one exact day. The old
// trigger was `daysUntil === 3`, a single-point test: one missed or failed run and the
// reminder was skipped permanently, with no catch-up. The forfeit branch self-heals
// because `< 0` stays true forever; this one did not.
export const REMINDER_WINDOW_DAYS = 3

const DAY_MS = 86_400_000

export type FlexDeadlinePhase = 'forfeit' | 'remind' | 'none'

/** Whole days from `todayStr` to `endDate`, both `YYYY-MM-DD` Pacific date strings. */
export function daysUntilDeadline(endDate: string, todayStr: string): number {
  return Math.round(
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${todayStr}T00:00:00Z`)) / DAY_MS
  )
}

export function flexDeadlinePhase(endDate: string, todayStr: string): FlexDeadlinePhase {
  const daysUntil = daysUntilDeadline(endDate, todayStr)
  if (daysUntil < 0) return 'forfeit'
  if (daysUntil <= REMINDER_WINDOW_DAYS) return 'remind'
  return 'none'
}

/**
 * A widened window can fire on up to four consecutive days, so the reminder needs a dedupe
 * key. It is per-user rather than per-league on purpose: an entrant who registers late
 * still gets their one reminder, which a league-level "already sent" flag would deny them.
 */
export function recipientsNeedingReminder(
  entrantIds: readonly string[],
  alreadyReminded: ReadonlySet<string>
): string[] {
  return [...new Set(entrantIds)].filter((id) => !alreadyReminded.has(id))
}
