// Team League schedule — a round-robin of TEAMS across weekly matchdays. Reuses the
// shared circle-method pairing (no fork), keyed on team ids. Deterministic on the input
// team order (the caller decides the seed order). See docs/phases/team-league.md §Step 3.

import { circleMethodPairs } from '../tournament/bracketBuilder'

export type TeamMatchup = { team1Id: string; team2Id: string }
export type TeamMatchday = { round: number; matchups: TeamMatchup[]; byeTeamId: string | null }

// Every team plays every other team once. Even N → N-1 matchdays; odd N → N matchdays
// with one bye per round (byeTeamId = the team sitting out that matchday).
export function buildTeamRoundRobin(teamIds: string[]): TeamMatchday[] {
  if (teamIds.length < 2) return []
  return circleMethodPairs(teamIds).map((pairs, i) => {
    const playing = new Set(pairs.flat())
    return {
      round: i + 1,
      matchups: pairs.map(([team1Id, team2Id]) => ({ team1Id, team2Id })),
      byeTeamId: teamIds.find((id) => !playing.has(id)) ?? null,
    }
  })
}
