/**
 * Unit tests for poolPlayMatches() in bracketBuilder.ts.
 *
 * Pool play splits N teams across K pools (snake-distributed by registration
 * order), then runs a round-robin inside each pool using the circle method.
 * Pools share round_number so the schedule packer can run pool 1's round 1
 * alongside pool 2's round 1 in the same wave.
 */

import { describe, it, expect } from 'vitest'
import { poolPlayMatches } from '../bracketBuilder'

function canonical(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

// Lightweight row accessor — the underlying rows are Record<string, unknown>
// (BaseMatch) but we know the shape we're inserting.
function row(r: Record<string, unknown>) {
  return {
    team_1: r.team_1_registration_id as string,
    team_2: r.team_2_registration_id as string,
    pool:   r.pool_number as number,
    round:  r.round_number as number,
    match:  r.match_number as number,
    stage:  r.match_stage as string,
  }
}

describe('poolPlayMatches', () => {
  it('returns no rows when no team has a pool partner', () => {
    const { rows } = poolPlayMatches(['A'], 2, {})
    expect(rows).toEqual([])
  })

  it('snake-distributes 8 teams across 2 pools (registration-order seed)', () => {
    const teams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const { rows } = poolPlayMatches(teams, 2, {})

    const pool1Teams = new Set<string>()
    const pool2Teams = new Set<string>()
    for (const raw of rows) {
      const r = row(raw)
      if (r.pool === 1) { pool1Teams.add(r.team_1); pool1Teams.add(r.team_2) }
      if (r.pool === 2) { pool2Teams.add(r.team_1); pool2Teams.add(r.team_2) }
    }
    // Pool 1: indexes 0, 2, 4, 6 = A, C, E, G.
    // Pool 2: indexes 1, 3, 5, 7 = B, D, F, H.
    expect([...pool1Teams].sort()).toEqual(['A', 'C', 'E', 'G'])
    expect([...pool2Teams].sort()).toEqual(['B', 'D', 'F', 'H'])
  })

  it('every pair within a pool plays exactly once', () => {
    const { rows } = poolPlayMatches(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], 2, {})

    // 4 teams per pool → C(4, 2) = 6 matches per pool → 12 matches total.
    expect(rows).toHaveLength(12)

    const pool1Pairs = new Set<string>()
    const pool2Pairs = new Set<string>()
    for (const raw of rows) {
      const r = row(raw)
      const key = canonical(r.team_1, r.team_2)
      if (r.pool === 1) pool1Pairs.add(key)
      else pool2Pairs.add(key)
    }
    expect(pool1Pairs.size).toBe(6)
    expect(pool2Pairs.size).toBe(6)
  })

  it('splits each 4-team pool into 3 rounds of 2 matches each', () => {
    const { rows } = poolPlayMatches(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], 2, {})

    const groups = new Map<string, number>()
    for (const raw of rows) {
      const r = row(raw)
      const key = `pool${r.pool}-rd${r.round}`
      groups.set(key, (groups.get(key) ?? 0) + 1)
    }
    // 2 pools × 3 rounds = 6 distinct (pool, round) buckets, 2 matches each.
    expect(groups.size).toBe(6)
    for (const [, count] of groups) {
      expect(count).toBe(2)
    }
  })

  it('shares round_number across pools so parallel rounds line up in the same wave', () => {
    const { rows } = poolPlayMatches(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], 2, {})

    const pool1Rounds = new Set<number>()
    const pool2Rounds = new Set<number>()
    for (const raw of rows) {
      const r = row(raw)
      if (r.pool === 1) pool1Rounds.add(r.round)
      else pool2Rounds.add(r.round)
    }
    // Both pools should produce rounds 1, 2, 3 — not pool 1 with 1/2/3 and
    // pool 2 with 4/5/6.
    expect([...pool1Rounds].sort()).toEqual([1, 2, 3])
    expect([...pool2Rounds].sort()).toEqual([1, 2, 3])
  })

  it('never places a team twice in the same (pool, round)', () => {
    const { rows } = poolPlayMatches(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], 2, {})

    const buckets = new Map<string, Set<string>>()
    for (const raw of rows) {
      const r = row(raw)
      const key = `pool${r.pool}-rd${r.round}`
      if (!buckets.has(key)) buckets.set(key, new Set())
      const seen = buckets.get(key)!
      expect(seen.has(r.team_1)).toBe(false)
      expect(seen.has(r.team_2)).toBe(false)
      seen.add(r.team_1)
      seen.add(r.team_2)
    }
  })

  it('handles odd pool sizes with a silent bye each round', () => {
    // 5 teams in 1 pool → 5 rounds, each round has 2 real matches (one bye)
    // → 10 total matches = C(5, 2).
    const { rows } = poolPlayMatches(['A', 'B', 'C', 'D', 'E'], 1, {})
    expect(rows).toHaveLength(10)

    const byRound = new Map<number, number>()
    for (const raw of rows) {
      const r = row(raw)
      byRound.set(r.round, (byRound.get(r.round) ?? 0) + 1)
    }
    expect(byRound.size).toBe(5)
    for (const [, count] of byRound) {
      expect(count).toBe(2)
    }
  })

  it('stamps every row with match_stage = "pool_play" and a sequential match_number', () => {
    const { rows, nextMatchNum } = poolPlayMatches(['A', 'B', 'C', 'D'], 2, {}, 50)

    // 2 teams per pool × 2 pools = 1 match per pool × 2 pools = 2 matches total.
    expect(rows).toHaveLength(2)
    for (const raw of rows) {
      expect(row(raw).stage).toBe('pool_play')
    }
    const nums = rows.map(r => row(r).match).sort((a, b) => a - b)
    expect(nums[0]).toBe(50)
    expect(nums[nums.length - 1]).toBe(51)
    expect(nextMatchNum).toBe(52)
  })

  it('carries base fields through to every row', () => {
    const base = { tournament_id: 'T1', division_id: 'D1', status: 'scheduled' }
    const { rows } = poolPlayMatches(['A', 'B', 'C', 'D'], 1, base)
    for (const raw of rows) {
      expect(raw.tournament_id).toBe('T1')
      expect(raw.division_id).toBe('D1')
      expect(raw.status).toBe('scheduled')
    }
  })
})

describe('poolPlayMatches — manual pool assignment', () => {
  const teamsInPools = (rows: Record<string, unknown>[]) => {
    const pools = new Map<number, Set<string>>()
    for (const raw of rows) {
      const r = row(raw)
      if (!pools.has(r.pool)) pools.set(r.pool, new Set())
      pools.get(r.pool)!.add(r.team_1)
      pools.get(r.pool)!.add(r.team_2)
    }
    return pools
  }

  it('places explicitly-assigned teams into their pool', () => {
    // Assigned the opposite of the default alternation to prove it's honored.
    const assignments = new Map([['A', 1], ['B', 1], ['C', 2], ['D', 2]])
    const { rows } = poolPlayMatches(['A', 'B', 'C', 'D'], 2, {}, 1, assignments)
    const pools = teamsInPools(rows)
    expect([...pools.get(1)!].sort()).toEqual(['A', 'B'])
    expect([...pools.get(2)!].sort()).toEqual(['C', 'D'])
  })

  it('auto-balances unassigned teams into the smallest pool', () => {
    // A,B pinned to pool 1; C,D unassigned should both fall into the emptier pool 2.
    const assignments = new Map([['A', 1], ['B', 1]])
    const { rows } = poolPlayMatches(['A', 'B', 'C', 'D'], 2, {}, 1, assignments)
    const pools = teamsInPools(rows)
    expect([...pools.get(1)!].sort()).toEqual(['A', 'B'])
    expect([...pools.get(2)!].sort()).toEqual(['C', 'D'])
  })

  it('falls back to alternating when assignments is empty', () => {
    const { rows } = poolPlayMatches(['A', 'B', 'C', 'D'], 2, {}, 1, new Map())
    const pools = teamsInPools(rows)
    expect([...pools.get(1)!].sort()).toEqual(['A', 'C'])
    expect([...pools.get(2)!].sort()).toEqual(['B', 'D'])
  })
})
