import { computeStandings, type StandingsMatchInput, type StandingsRegInput, type StandingsRow } from './standings'

export type PoolMatchInput = StandingsMatchInput & { pool_number: number | null }

/**
 * Per-pool standings, each restricted to that pool's participants so a player never
 * picks up a phantom 0–0 row from the other pool. Pools are returned in pool-number
 * order (Pool 1, Pool 2, …) — the natural order for display.
 */
export function poolStandings(
  matches: PoolMatchInput[],
  regs: StandingsRegInput[],
  nameOf?: (regId: string) => string,
): Array<{ pool: number; rows: StandingsRow[] }> {
  const poolNumbers = Array.from(
    new Set(matches.map(m => m.pool_number).filter((p): p is number => p != null)),
  ).sort((a, b) => a - b)

  return poolNumbers.map(pool => {
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
    return { pool, rows: computeStandings(poolMatches, poolRegs, nameOf) }
  })
}

// Strength of a pool, judged by its top finisher: win% → point differential →
// points-for → the team's original (organizer) seed. Pool winners from different
// pools never played each other, so this is how a cross-pool tie is broken.
function winnerStrength(row: StandingsRow | undefined, seedOf?: (regId: string) => number) {
  if (!row) return { winPct: -1, diff: -Infinity, pf: -1, seed: Infinity }
  const games = row.wins + row.losses
  return {
    winPct: games ? row.wins / games : 0,
    diff: row.pf - row.pa,
    pf: row.pf,
    seed: seedOf?.(row.regId) ?? Infinity,
  }
}

/**
 * Seeds the playoff qualifiers for a Pool Play + Playoffs division.
 *
 * Takes the top `advancePerPool` from each pool. Pools are ordered by the strength
 * of their winner (win% → +/- → points-for → original seed) — one consistent order
 * across every rank — then interleaved by rank: every pool's winner first, then
 * every pool's runner-up, and so on. Feeding that into the standard bracket seeder
 * pairs a pool winner against another pool's runner-up and keeps same-pool players
 * in opposite halves (they can't meet again until the final). Ordering pools by
 * winner strength makes the stronger pool's winner the #1 overall seed; keeping that
 * order the same for every rank is what preserves the same-pool separation.
 *
 *   2 pools, top 2 → [strongerPool#1, otherPool#1, strongerPool#2, otherPool#2]
 *   → bracket round 1: (strongerPool#1 vs otherPool#2) and (otherPool#1 vs strongerPool#2)
 */
export function poolPlayoffSeeds(
  matches: PoolMatchInput[],
  regs: StandingsRegInput[],
  advancePerPool: number,
  nameOf?: (regId: string) => string,
  seedOf?: (regId: string) => number,
): string[] {
  const pools = poolStandings(matches, regs, nameOf)

  const ordered = [...pools].sort((a, b) => {
    const sa = winnerStrength(a.rows[0], seedOf)
    const sb = winnerStrength(b.rows[0], seedOf)
    if (sb.winPct !== sa.winPct) return sb.winPct - sa.winPct
    if (sb.diff !== sa.diff) return sb.diff - sa.diff
    if (sb.pf !== sa.pf) return sb.pf - sa.pf
    if (sa.seed !== sb.seed) return sa.seed - sb.seed   // lower original seed first
    return 0                                            // truly identical → keep pool order
  })

  const seeds: string[] = []
  for (let rank = 0; rank < advancePerPool; rank++) {
    for (const { rows } of ordered) {
      if (rank < rows.length) seeds.push(rows[rank].regId)
    }
  }
  return seeds
}
