import type { ScheduleSettings } from '@/lib/types'

// Pure, dependency-free estimate helpers for the Advanced Schedule Builder.
// Everything here is an *estimate* for capacity planning — actual match counts
// come from bracketBuilder.ts at generation time and may differ slightly
// (e.g. double-elimination grand-final resets, BYE collapses).

/** 'HH:MM' or 'HH:MM:SS' → minutes since midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Minutes between two same-day time strings; never negative. */
export function blockDurationMinutes(startTime: string, endTime: string): number {
  return Math.max(0, timeToMinutes(endTime) - timeToMinutes(startTime))
}

/**
 * Estimated number of matches a division produces for the given bracket type and
 * team count. Returns null for unknown formats ("estimate unavailable") rather
 * than throwing, so the UI degrades gracefully.
 */
export function estimateMatchCount(
  bracketType: string,
  teamCount: number,
  formatSettings?: Record<string, unknown> | null,
): number | null {
  if (teamCount < 2) return 0
  switch (bracketType) {
    case 'single_elimination':
      // One team eliminated per match; champion is the only survivor.
      return teamCount - 1
    case 'double_elimination':
      // Worst case every team must lose twice: ~2n-1 plus a possible grand-final
      // reset. 2n-1 is a safe planning estimate.
      return 2 * teamCount - 1
    case 'round_robin':
      return (teamCount * (teamCount - 1)) / 2
    case 'pool_play_playoffs': {
      const numPools = Math.max(1, (formatSettings?.number_of_pools as number) ?? 2)
      // Even split across pools, round-robin within each, then a single-elim
      // playoff among the pool winners.
      const base = Math.floor(teamCount / numPools)
      const remainder = teamCount % numPools
      let poolMatches = 0
      for (let i = 0; i < numPools; i++) {
        const size = base + (i < remainder ? 1 : 0)
        poolMatches += (size * (size - 1)) / 2
      }
      const playoffMatches = Math.max(0, numPools - 1)
      return poolMatches + playoffMatches
    }
    default:
      return null
  }
}

/** Total court-minutes a division needs: matches × (match + buffer). */
export function divisionCourtMinutes(matchCount: number, settings: ScheduleSettings): number {
  return matchCount * (settings.match_duration_minutes + settings.buffer_minutes)
}

export type DivisionEstimate = {
  teamCount: number
  matches: number | null      // null = estimate unavailable
  courtMinutes: number | null
}

/**
 * Estimate a single division's match count and court-time. Rotating partner mode
 * uses a different match formula than the static bracket types, so we mark it
 * unavailable for the MVP rather than reporting a wrong number.
 */
export function estimateDivision(
  bracketType: string,
  partnerMode: string,
  teamCount: number,
  formatSettings: Record<string, unknown> | null | undefined,
  settings: ScheduleSettings,
): DivisionEstimate {
  if (partnerMode === 'rotating') return { teamCount, matches: null, courtMinutes: null }
  const matches = estimateMatchCount(bracketType, teamCount, formatSettings)
  return {
    teamCount,
    matches,
    courtMinutes: matches == null ? null : divisionCourtMinutes(matches, settings),
  }
}

export type BlockCapacity = {
  courtCount: number
  durationMinutes: number    // raw window length
  usableMinutes: number      // window minus end buffer if configured
  courtMinutes: number       // courtCount × usableMinutes
  matchCapacity: number      // how many matches fit
}

/** Estimated match capacity of a block from its courts, window, and settings. */
export function blockCapacity(
  courtCount: number,
  startTime: string,
  endTime: string,
  settings: ScheduleSettings,
): BlockCapacity {
  const durationMinutes = blockDurationMinutes(startTime, endTime)
  const usableMinutes = settings.leave_end_buffer
    ? Math.max(0, durationMinutes - settings.end_buffer_minutes)
    : durationMinutes
  const perMatch = settings.match_duration_minutes + settings.buffer_minutes
  const courtMinutes = courtCount * usableMinutes
  const matchCapacity = perMatch > 0 ? Math.floor(courtMinutes / perMatch) : 0
  return { courtCount, durationMinutes, usableMinutes, courtMinutes, matchCapacity }
}
