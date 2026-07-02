import { computeStandings, type StandingsRow } from '../tournament/standings'
import type { LeagueFixture } from '../types'

// Shared standings for the fixture-based league formats (box / flex / team),
// reusing the tournament standings core so we never fork the ranking rules
// (win% → point differential → points-for → name). Box/flex fixtures are
// registration-based, so they map 1:1 onto the core's StandingsMatchInput —
// no new ranking math, just a scope filter and a field rename.
//
// Entity = team registration (the core folds doubles partners via
// partner_registration_id). Individual-accumulation (session_rr) and
// team-of-players (Team League) entity modes are DEFERRED until those formats
// need them — see docs/phases/league-formats.md §6. Keeping the core untouched
// preserves 100% of the tournament + current-league standings behavior.

// Minimal registration shape the core needs to fold doubles pairs.
export type FixtureStandingsReg = {
  id: string
  status: string
  partner_registration_id: string | null
}

// Which slice of fixtures to rank. Omit for whole-league; set boxId for per-box
// (Box League) or periodId for per-cycle/window. Scope is "which rows go in" —
// the caller pre-filters, so the core stays scope-agnostic.
export type FixtureStandingsScope = {
  boxId?: string | null
  periodId?: string | null
}

export function computeFixtureStandings(
  fixtures: LeagueFixture[],
  regs: FixtureStandingsReg[],
  scope: FixtureStandingsScope = {},
  nameOf?: (regId: string) => string,
): StandingsRow[] {
  const scoped = fixtures.filter(f => {
    if (scope.boxId != null && f.box_id !== scope.boxId) return false
    if (scope.periodId != null && f.period_id !== scope.periodId) return false
    return true
  })

  // LeagueFixture already carries the exact fields StandingsMatchInput expects.
  const matches = scoped.map(f => ({
    match_stage: f.match_stage,
    round_number: f.round_number,
    status: f.status,
    team_1_registration_id: f.team_1_registration_id,
    team_2_registration_id: f.team_2_registration_id,
    team_1_score: f.team_1_score,
    team_2_score: f.team_2_score,
    winner_registration_id: f.winner_registration_id,
  }))

  return computeStandings(matches, regs, nameOf)
}
