/**
 * Unit tests for roundRobinMatches() in bracketBuilder.ts.
 *
 * The circle-method scheduler is the core of round-robin tournaments:
 *  - every pair plays exactly once
 *  - no team appears twice in the same round
 *  - even N → (N-1) rounds, N/2 matches each
 *  - odd  N → N rounds, (N-1)/2 matches each (one bye per round)
 *
 * If any of these invariants break, the schedule packer in ScheduleManager
 * can't fit a whole round into one wave and the operator sees a broken
 * schedule on tournament day.
 */

import { describe, it, expect } from 'vitest'
import { roundRobinMatches } from '../bracketBuilder'

type MatchRow = {
  team_1_registration_id: string
  team_2_registration_id: string
  round_number: number
  match_number: number
  match_stage: string
}

function canonical(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function groupByRound(rows: MatchRow[]): Map<number, MatchRow[]> {
  const map = new Map<number, MatchRow[]>()
  for (const r of rows) {
    if (!map.has(r.round_number)) map.set(r.round_number, [])
    map.get(r.round_number)!.push(r)
  }
  return map
}

describe('roundRobinMatches', () => {
  it('returns no rows for fewer than 2 teams', () => {
    expect(roundRobinMatches([], {}).rows).toEqual([])
    expect(roundRobinMatches(['A'], {}).rows).toEqual([])
  })

  it('produces every unique pair exactly once (4 teams)', () => {
    const { rows } = roundRobinMatches(['A', 'B', 'C', 'D'], {})
    const pairs = new Set(rows.map(r => canonical(r.team_1_registration_id as string, r.team_2_registration_id as string)))
    expect(rows).toHaveLength(6) // 4 choose 2
    expect(pairs.size).toBe(6)
  })

  it('produces every unique pair exactly once (8 teams — the demo case)', () => {
    const teams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const { rows } = roundRobinMatches(teams, {})
    const pairs = new Set(rows.map(r => canonical(r.team_1_registration_id as string, r.team_2_registration_id as string)))
    expect(rows).toHaveLength(28) // 8 choose 2
    expect(pairs.size).toBe(28)
  })

  it('splits 8 teams into 7 rounds of 4 matches each', () => {
    const teams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const { rows } = roundRobinMatches(teams, {})
    const byRound = groupByRound(rows as MatchRow[])
    expect(byRound.size).toBe(7)
    for (const [, roundMatches] of byRound) {
      expect(roundMatches).toHaveLength(4)
    }
  })

  it('splits 5 teams into 5 rounds with one bye per round (2 real matches each)', () => {
    const { rows } = roundRobinMatches(['A', 'B', 'C', 'D', 'E'], {})
    const byRound = groupByRound(rows as MatchRow[])
    expect(rows).toHaveLength(10) // 5 choose 2
    expect(byRound.size).toBe(5)
    for (const [, roundMatches] of byRound) {
      expect(roundMatches).toHaveLength(2)
    }
  })

  it('never places a team in the same round twice', () => {
    const teams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const { rows } = roundRobinMatches(teams, {})
    const byRound = groupByRound(rows as MatchRow[])
    for (const [, roundMatches] of byRound) {
      const seen = new Set<string>()
      for (const m of roundMatches) {
        expect(seen.has(m.team_1_registration_id)).toBe(false)
        expect(seen.has(m.team_2_registration_id)).toBe(false)
        seen.add(m.team_1_registration_id)
        seen.add(m.team_2_registration_id)
      }
    }
  })

  it('stamps every row with match_stage = "round_robin"', () => {
    const { rows } = roundRobinMatches(['A', 'B', 'C', 'D'], {})
    for (const r of rows) {
      expect(r.match_stage).toBe('round_robin')
    }
  })

  it('numbers matches sequentially starting from startMatchNum', () => {
    const { rows, nextMatchNum } = roundRobinMatches(['A', 'B', 'C', 'D'], {}, 100)
    const numbers = rows.map(r => r.match_number as number).sort((a, b) => a - b)
    expect(numbers[0]).toBe(100)
    expect(numbers[numbers.length - 1]).toBe(105)
    expect(nextMatchNum).toBe(106)
  })

  it('carries through fields from the base object', () => {
    const base = { tournament_id: 'T1', division_id: 'D1', status: 'scheduled' }
    const { rows } = roundRobinMatches(['A', 'B', 'C'], base)
    for (const r of rows) {
      expect(r.tournament_id).toBe('T1')
      expect(r.division_id).toBe('D1')
      expect(r.status).toBe('scheduled')
    }
  })
})
