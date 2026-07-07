import { describe, it, expect } from 'vitest'
import {
  generateInitialRanking,
  seedKotcRound,
  nextKotcRound,
  boundedMovement,
  reintegrateRanking,
  type LadderEntrant,
  type CourtAssignment,
  type CourtResult,
} from '../ladder'

const entrant = (id: string, rating: number | null = null, registeredAt: string | null = null): LadderEntrant =>
  ({ registrationId: id, rating, registeredAt })

describe('generateInitialRanking', () => {
  it('rating: descending, unrated last, stable on ties', () => {
    const e = [entrant('a', 3.0), entrant('b', 4.5), entrant('c', null), entrant('d', 4.5)]
    expect(generateInitialRanking(e, 'rating')).toEqual(['b', 'd', 'a', 'c'])
  })

  it('registration: earliest first, unknown timestamps last', () => {
    const e = [
      entrant('a', null, '2026-02-01T00:00:00Z'),
      entrant('b', null, null),
      entrant('c', null, '2026-01-01T00:00:00Z'),
    ]
    expect(generateInitialRanking(e, 'registration')).toEqual(['c', 'a', 'b'])
  })

  it('manual: preserves input order', () => {
    const e = [entrant('x'), entrant('y'), entrant('z')]
    expect(generateInitialRanking(e, 'manual')).toEqual(['x', 'y', 'z'])
  })

  it('random: deterministic (same input → same order) but not identity', () => {
    const e = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => entrant(id))
    const once = generateInitialRanking(e, 'random')
    expect(generateInitialRanking(e, 'random')).toEqual(once)
    expect(once).not.toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect([...once].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })
})

describe('seedKotcRound', () => {
  it('even count: pairs top-down onto courts of two, no bye', () => {
    const { courts, bye } = seedKotcRound(['1', '2', '3', '4', '5', '6'])
    expect(bye).toBeNull()
    expect(courts).toEqual([
      { court: 1, a: '1', b: '2' },
      { court: 2, a: '3', b: '4' },
      { court: 3, a: '5', b: '6' },
    ])
  })

  it('odd count: lowest-ranked present byes', () => {
    const { courts, bye } = seedKotcRound(['1', '2', '3', '4', '5'])
    expect(bye).toBe('5')
    expect(courts).toEqual([
      { court: 1, a: '1', b: '2' },
      { court: 2, a: '3', b: '4' },
    ])
  })
})

describe('nextKotcRound (up-down)', () => {
  const resultsFrom = (prev: CourtAssignment, winners: string[]): CourtResult[] =>
    prev.courts.map((c, i) => ({ court: c.court, winner: winners[i], loser: winners[i] === c.a ? c.b : c.a }))

  it('winner up a court, loser down; top/bottom hold; keeps 2 per court', () => {
    const prev = seedKotcRound(['1', '2', '3', '4', '5', '6']) // C1[1,2] C2[3,4] C3[5,6]
    // higher-seed wins each court
    const next = nextKotcRound(prev, resultsFrom(prev, ['1', '3', '5']))
    expect(next.courts).toEqual([
      { court: 1, a: '1', b: '3' }, // c1 winner stays + c2 winner up
      { court: 2, a: '2', b: '5' }, // c1 loser down + c3 winner up
      { court: 3, a: '4', b: '6' }, // c2 loser down + c3 loser stays
    ])
    expect(next.courts.flatMap((c) => [c.a, c.b]).sort()).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('a full simulation converges: the consistently strongest reaches the top court', () => {
    // 8 players; a lower id always beats a higher id. After enough rounds the top
    // court should hold {1,2}.
    let asg = seedKotcRound(['1', '2', '3', '4', '5', '6', '7', '8'])
    for (let r = 0; r < 8; r++) {
      const results = asg.courts.map((c) => {
        const winner = Number(c.a) < Number(c.b) ? c.a : c.b
        return { court: c.court, winner, loser: winner === c.a ? c.b : c.a }
      })
      asg = nextKotcRound(asg, results)
    }
    expect([asg.courts[0].a, asg.courts[0].b].sort()).toEqual(['1', '2'])
  })

  it('odd count: bye rotates (returning sitter re-enters, bottom entrant sits)', () => {
    const prev = seedKotcRound(['1', '2', '3', '4', '5']) // C1[1,2] C2[3,4] bye 5
    const next = nextKotcRound(prev, resultsFrom(prev, ['1', '3']))
    // c1: [1, 3(up)]; c2: [2(down), 4(c2 loser stays)] → then loser-sits: bottom '4' sits, '5' returns
    expect(next.bye).toBe('4')
    expect(next.courts).toEqual([
      { court: 1, a: '1', b: '3' },
      { court: 2, a: '2', b: '5' },
    ])
    // everyone accounted for exactly once (5 players: 4 on court + 1 bye)
    expect([...next.courts.flatMap((c) => [c.a, c.b]), next.bye].sort()).toEqual(['1', '2', '3', '4', '5'])
  })
})

describe('boundedMovement', () => {
  const scoreMap = (m: Record<string, number>) => (id: string) => m[id] ?? 0

  it('maxMove 0 is a no-op', () => {
    expect(boundedMovement(['a', 'b', 'c'], scoreMap({ a: 0, b: 9, c: 9 }), 0)).toEqual(['a', 'b', 'c'])
  })

  it('moves toward the performance order, capped at maxMove positions', () => {
    // Current order a..f; f had the best night. With maxMove 2, f can rise at most
    // 2 spots (to index 3), NOT jump to the top.
    const order = ['a', 'b', 'c', 'd', 'e', 'f']
    const score = scoreMap({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 99 })
    const out = boundedMovement(order, score, 2)
    expect(out.indexOf('f')).toBe(3)
    // no entrant moved more than 2 positions
    for (const id of order) expect(Math.abs(out.indexOf(id) - order.indexOf(id))).toBeLessThanOrEqual(2)
  })

  it('with enough passes, fully sorts to the performance order', () => {
    const order = ['a', 'b', 'c', 'd']
    const score = scoreMap({ a: 1, b: 4, c: 2, d: 3 }) // desired: b, d, c, a
    expect(boundedMovement(order, score, 10)).toEqual(['b', 'd', 'c', 'a'])
  })

  it('a strong night lifts you and drops the neighbor you passed', () => {
    const out = boundedMovement(['x', 'y'], scoreMap({ x: 1, y: 5 }), 1)
    expect(out).toEqual(['y', 'x'])
  })
})

describe('reintegrateRanking', () => {
  it('absent players hold their exact slot; present slots refill in the new order', () => {
    const current = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    const present = new Set(['A', 'B', 'D', 'E', 'F', 'G', 'H']) // C absent
    const newPresentOrder = ['B', 'A', 'E', 'D', 'G', 'F', 'H']
    expect(reintegrateRanking(current, present, newPresentOrder)).toEqual(['B', 'A', 'C', 'E', 'D', 'G', 'F', 'H'])
  })

  it('multiple absentees all hold; present refill around them', () => {
    const current = ['A', 'B', 'C', 'D', 'E']
    const present = new Set(['A', 'C', 'E']) // B, D absent
    expect(reintegrateRanking(current, present, ['E', 'C', 'A'])).toEqual(['E', 'B', 'C', 'D', 'A'])
  })

  it('nobody absent → just the new present order', () => {
    expect(reintegrateRanking(['A', 'B', 'C'], new Set(['A', 'B', 'C']), ['C', 'A', 'B'])).toEqual(['C', 'A', 'B'])
  })
})
