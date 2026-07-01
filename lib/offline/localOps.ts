import { computeStandings, type StandingsMatchInput, type StandingsRegInput } from '../tournament/standings'
import { poolStandings, type PoolMatchInput } from '../tournament/poolPlayoffSeeding'
import { resolvePlayoffSource, type PlayoffSource } from '../tournament/playoffPlaceholders'
import { resolveBracket } from '../tournament/resolveCompletion'
import { applyMutations, type LocalMatch } from './applyMutations'

// The non-scoring day-of operations, as pure array transforms — the browser twins of their
// API routes, for Phase-2 offline run mode. Each is idempotent so an outbox replay is safe.
// (Scoring is scoreLocally in localAdvance.ts.) See docs/phases/offline-run-mode-phase-2.md.

// ── Check-in ────────────────────────────────────────────────────────────────────
export type LocalReg = {
  id: string
  checked_in?: boolean | null
  status?: string
  partner_registration_id?: string | null
  [k: string]: unknown
}

/** Set a registration's check-in flag. Idempotent — setting the same value is a no-op. */
export function checkInLocally<T extends LocalReg>(regs: T[], regId: string, checkedIn: boolean): T[] {
  return regs.map(r => (r.id === regId ? { ...r, checked_in: checkedIn } : r))
}

// ── Reschedule ──────────────────────────────────────────────────────────────────
export type ReschedulableMatch = LocalMatch & { court_number?: number | null; scheduled_time?: string | null }

/** Move a match to a court/time. Last-write-wins → replay-safe. */
export function rescheduleLocally<T extends ReschedulableMatch>(
  matches: T[], matchId: string, courtNumber: number | null, scheduledTime: string | null,
): T[] {
  return matches.map(m => (m.id === matchId ? { ...m, court_number: courtNumber, scheduled_time: scheduledTime } : m))
}

// ── Resolve playoffs (seed placeholders from standings) ──────────────────────────
const PLAYOFF_STAGES = new Set(['playoffs', 'single_elimination', 'winners_bracket', 'losers_bracket', 'championship'])
type ResolvableMatch = LocalMatch & { pool_number?: number | null }

/**
 * Seed the placeholder playoff bracket from the local standings — the browser twin of the
 * resolve-playoffs route. Fills each first-round placeholder slot from its source position
 * (round-robin overall rank, or per-pool rank), clears the sources, then cascades byes via
 * resolveBracket. Idempotent: once the sources are cleared there's nothing to seed, so a
 * re-run leaves the bracket unchanged.
 */
export function resolvePlayoffsLocally<T extends ResolvableMatch>(
  matches: T[],
  regs: StandingsRegInput[],
  bracketType: string,
  nameOf?: (regId: string) => string,
): T[] {
  const isRR = bracketType === 'round_robin'
  const isPool = bracketType === 'pool_play_playoffs'
  if (!isRR && !isPool) return matches

  const baseStage = isRR ? 'round_robin' : 'pool_play'
  const baseMatches = matches.filter(m => m.match_stage === baseStage)

  const overall = isRR ? computeStandings(baseMatches as unknown as StandingsMatchInput[], regs, nameOf) : []
  const poolMap = new Map<number, { regId: string }[]>()
  if (isPool) {
    for (const { pool, rows } of poolStandings(baseMatches as unknown as PoolMatchInput[], regs, nameOf)) poolMap.set(pool, rows)
  }

  const filled = matches.map(m => {
    if (!PLAYOFF_STAGES.has(m.match_stage)) return m
    const s1 = m.team_1_source as PlayoffSource | null | undefined
    const s2 = m.team_2_source as PlayoffSource | null | undefined
    if (s1 == null && s2 == null) return m
    return {
      ...m,
      team_1_registration_id: s1 ? resolvePlayoffSource(s1, overall, poolMap) : m.team_1_registration_id,
      team_2_registration_id: s2 ? resolvePlayoffSource(s2, overall, poolMap) : m.team_2_registration_id,
      team_1_source: null,
      team_2_source: null,
    }
  })
  return applyMutations(filled as unknown as LocalMatch[], resolveBracket(filled as unknown as LocalMatch[])) as unknown as T[]
}
