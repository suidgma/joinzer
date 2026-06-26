import { describe, it, expect } from 'vitest'
import { poolPlayoffSeeds, type PoolMatchInput } from '../poolPlayoffSeeding'
import { singleEliminationBracket, type MatchRow } from '../bracketBuilder'
import type { StandingsRegInput } from '../standings'

// Pool 1 = A,B,C ; Pool 2 = D,E,F. Each pool a 3-player round robin.
const POOL = { A: 1, B: 1, C: 1, D: 2, E: 2, F: 2 } as const
const regs: StandingsRegInput[] = Object.keys(POOL).map(id => ({ id, status: 'registered', partner_registration_id: null }))

const pm = (pool: number, t1: string, t2: string, s1: number, s2: number): PoolMatchInput => ({
  match_stage: 'pool_play', pool_number: pool, round_number: 1, status: 'completed',
  team_1_registration_id: t1, team_2_registration_id: t2,
  team_1_score: s1, team_2_score: s2, winner_registration_id: s1 > s2 ? t1 : t2,
})

// Pool 1: A 2-0, B 1-1, C 0-2.  Pool 2: D 2-0, E 1-1, F 0-2.
const poolMatches: PoolMatchInput[] = [
  pm(1, 'A', 'B', 11, 5), pm(1, 'A', 'C', 11, 3), pm(1, 'B', 'C', 11, 7),
  pm(2, 'D', 'E', 11, 4), pm(2, 'D', 'F', 11, 6), pm(2, 'E', 'F', 11, 9),
]

describe('poolPlayoffSeeds', () => {
  it('takes the top 2 from each pool, interleaved by rank across pools', () => {
    const seeds = poolPlayoffSeeds(poolMatches, regs, 2)
    // rank 1 of every pool, then rank 2 of every pool → [P1#1, P2#1, P1#2, P2#2]
    expect(seeds).toEqual(['A', 'D', 'B', 'E'])
  })

  it('takes only the pool winners when one advances per pool', () => {
    expect(poolPlayoffSeeds(poolMatches, regs, 1)).toEqual(['A', 'D'])
  })

  it('computes each pool\'s standings over that pool only (no phantom rows)', () => {
    // C (pool 1, 0-2) and F (pool 2, 0-2) must be excluded when top 2 advance.
    const seeds = poolPlayoffSeeds(poolMatches, regs, 2)
    expect(seeds).not.toContain('C')
    expect(seeds).not.toContain('F')
  })

  it('seeds a bracket so round 1 is cross-pool and same-pool players are kept apart', () => {
    const seeds = poolPlayoffSeeds(poolMatches, regs, 2)
    const { rows } = singleEliminationBracket(seeds, 'single_elimination', {}, 1, true)
    const round1 = (rows as MatchRow[]).filter(r => r.round_number === 1)
    // Every round-1 match pairs players from DIFFERENT pools.
    for (const m of round1) {
      const p1 = POOL[m.team_1_registration_id as keyof typeof POOL]
      const p2 = POOL[m.team_2_registration_id as keyof typeof POOL]
      expect(p1).not.toBe(p2)
    }
  })
})
