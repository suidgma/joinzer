/**
 * Unit tests for rotatingDoublesMatches() in bracketBuilder.
 *
 * Used by tournament divisions where partner_mode='rotating'. Each match row
 * carries 4 distinct player registrations (team_1, team_1_partner, team_2,
 * team_2_partner). Across rounds, partners should vary — that's the whole
 * point of "rotating".
 */

import { describe, it, expect } from 'vitest'
import { rotatingDoublesMatches } from '../bracketBuilder'

function row(r: Record<string, unknown>) {
  return {
    t1:    r.team_1_registration_id as string,
    t1p:   r.team_1_partner_registration_id as string,
    t2:    r.team_2_registration_id as string,
    t2p:   r.team_2_partner_registration_id as string,
    round: r.round_number as number,
    match: r.match_number as number,
    stage: r.match_stage as string,
  }
}

function partnerKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

describe('rotatingDoublesMatches', () => {
  it('returns no rows for fewer than 4 players', () => {
    expect(rotatingDoublesMatches([], {}).rows).toEqual([])
    expect(rotatingDoublesMatches(['A', 'B', 'C'], {}).rows).toEqual([])
  })

  it('each match has 4 distinct player registrations across both sides', () => {
    const players = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const { rows } = rotatingDoublesMatches(players, {}, { rounds: 3 })
    expect(rows.length).toBeGreaterThan(0)
    for (const raw of rows) {
      const m = row(raw)
      const ids = new Set([m.t1, m.t1p, m.t2, m.t2p])
      expect(ids.size).toBe(4)
    }
  })

  it('every row is stamped with match_stage="round_robin"', () => {
    const { rows } = rotatingDoublesMatches(['A','B','C','D','E','F','G','H'], {}, { rounds: 3 })
    for (const raw of rows) {
      expect(row(raw).stage).toBe('round_robin')
    }
  })

  it('produces multiple distinct partnerships across rounds (rotation actually happens)', () => {
    const players = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    // 8 players, 5 rounds → 10 doubles matches → 20 partner pairings
    const { rows } = rotatingDoublesMatches(players, {}, { rounds: 5 })
    const partnerships = new Set<string>()
    for (const raw of rows) {
      const m = row(raw)
      partnerships.add(partnerKey(m.t1, m.t1p))
      partnerships.add(partnerKey(m.t2, m.t2p))
    }
    // With 8 players, C(8, 2) = 28 unique partnerships possible. Over 5 rounds
    // with the greedy avoider, we should see well over 10 distinct ones.
    expect(partnerships.size).toBeGreaterThan(10)
  })

  it('honors the rounds option', () => {
    const { rows } = rotatingDoublesMatches(['A','B','C','D','E','F','G','H'], {}, { rounds: 3 })
    const rounds = new Set(rows.map(r => row(r).round))
    expect(rounds).toEqual(new Set([1, 2, 3]))
  })

  it('defaults to N-1 rounds for even N', () => {
    // 8 players, default rounds = 7
    const { rows } = rotatingDoublesMatches(['A','B','C','D','E','F','G','H'], {})
    const rounds = new Set(rows.map(r => row(r).round))
    expect(rounds.size).toBe(7)
  })

  it('caps doubles matches per round at the courts limit', () => {
    // 8 players = 2 doubles courts naturally. Cap at 1 court → 1 match per round.
    const { rows } = rotatingDoublesMatches(['A','B','C','D','E','F','G','H'], {}, { rounds: 3, courts: 1 })
    const byRound = new Map<number, number>()
    for (const raw of rows) {
      const r = row(raw)
      byRound.set(r.round, (byRound.get(r.round) ?? 0) + 1)
    }
    expect(byRound.size).toBe(3)
    for (const [, count] of byRound) expect(count).toBe(1)
  })

  it('numbers matches sequentially starting from startMatchNum', () => {
    const { rows, nextMatchNum } = rotatingDoublesMatches(
      ['A','B','C','D','E','F','G','H'],
      {},
      { rounds: 2, startMatchNum: 100 }
    )
    const nums = rows.map(r => row(r).match).sort((a, b) => a - b)
    expect(nums[0]).toBe(100)
    expect(nextMatchNum).toBe(100 + rows.length)
  })

  it('carries base fields through to every row', () => {
    const base = { tournament_id: 'T1', division_id: 'D1', status: 'scheduled' }
    const { rows } = rotatingDoublesMatches(['A','B','C','D','E','F','G','H'], base, { rounds: 2 })
    for (const raw of rows) {
      expect(raw.tournament_id).toBe('T1')
      expect(raw.division_id).toBe('D1')
      expect(raw.status).toBe('scheduled')
    }
  })
})
