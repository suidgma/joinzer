import { computeStandings, type StandingsMatchInput, type StandingsRegInput } from './standings'

export type PoolMatchInput = StandingsMatchInput & { pool_number: number | null }

/**
 * Seeds the playoff qualifiers for a Pool Play + Playoffs division.
 *
 * Takes the top `advancePerPool` finishers from EACH pool (by the shared standings
 * rule — win% → +/- → points-for → name) and interleaves them by rank across pools:
 * every pool's winner first, then every pool's runner-up, and so on. Feeding that
 * order into the standard bracket seeder (`arrangeSeedsForBracket`) puts a pool
 * winner against another pool's runner-up and keeps same-pool players in opposite
 * halves, so they can't meet again until the final.
 *
 *   2 pools, top 2 →  [P1#1, P2#1, P1#2, P2#2]
 *   → bracket round 1: (P1#1 vs P2#2) and (P2#1 vs P1#2)
 *
 * Standings are computed per pool over that pool's participants only, so a player
 * never picks up a phantom 0–0 row from the other pool.
 */
export function poolPlayoffSeeds(
  matches: PoolMatchInput[],
  regs: StandingsRegInput[],
  advancePerPool: number,
  nameOf?: (regId: string) => string,
): string[] {
  const poolNumbers = Array.from(
    new Set(matches.map(m => m.pool_number).filter((p): p is number => p != null)),
  ).sort((a, b) => a - b)

  const perPoolStandings = poolNumbers.map(pool => {
    const poolMatches = matches.filter(m => m.pool_number === pool)
    // Restrict standings to this pool's participants (canonical reg + any partner).
    const ids = new Set<string>()
    for (const m of poolMatches) {
      if (m.team_1_registration_id) ids.add(m.team_1_registration_id)
      if (m.team_2_registration_id) ids.add(m.team_2_registration_id)
    }
    const poolRegs = regs.filter(
      r => ids.has(r.id) || (r.partner_registration_id != null && ids.has(r.partner_registration_id)),
    )
    return computeStandings(poolMatches, poolRegs, nameOf)
  })

  const seeds: string[] = []
  for (let rank = 0; rank < advancePerPool; rank++) {
    for (const standings of perPoolStandings) {
      if (rank < standings.length) seeds.push(standings[rank].regId)
    }
  }
  return seeds
}
