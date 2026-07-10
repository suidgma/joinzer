import { describe, it, expect } from 'vitest'
import { orderByServe, tallyFrom, balanceServeOrder, type ServeTally } from '../serveBalance'

const idKey = (x: string) => [x]

describe('orderByServe', () => {
  it('lists the side that has served first fewer times first', () => {
    const tally: ServeTally = new Map([['a', 3], ['b', 1]])
    expect(orderByServe('a', 'b', idKey, tally)).toEqual(['b', 'a'])
    expect(tally.get('b')).toBe(2) // b now served first once more
    expect(tally.get('a')).toBe(3)
  })

  it('keeps input order on a tie (stable)', () => {
    const tally: ServeTally = new Map()
    expect(orderByServe('a', 'b', idKey, tally)).toEqual(['a', 'b'])
    expect(tally.get('a')).toBe(1)
  })

  it('balances a repeated pairing toward 50/50', () => {
    const tally: ServeTally = new Map()
    let aFirst = 0
    for (let i = 0; i < 10; i++) {
      const [first] = orderByServe('a', 'b', idKey, tally)
      if (first === 'a') aFirst++
    }
    expect(aFirst).toBe(5) // perfectly alternates when only these two ever play
  })

  it('doubles: balances per player, not per ephemeral pair', () => {
    // Sides are pairs; balance on individual players.
    const tally: ServeTally = new Map([['p1', 2], ['p2', 2], ['p3', 0], ['p4', 0]])
    const sideA = { players: ['p1', 'p2'] }
    const sideB = { players: ['p3', 'p4'] }
    const [first] = orderByServe(sideA, sideB, (s) => s.players, tally)
    expect(first).toBe(sideB) // p3/p4 have served first less → they go first
    expect(tally.get('p3')).toBe(1)
    expect(tally.get('p4')).toBe(1)
  })
})

describe('tallyFrom', () => {
  it('counts prior first-listed sides', () => {
    const matches = [
      { first: ['a'] },
      { first: ['a'] },
      { first: ['b'] },
    ]
    const tally = tallyFrom(matches, (m) => m.first)
    expect(tally.get('a')).toBe(2)
    expect(tally.get('b')).toBe(1)
  })
})

describe('balanceServeOrder', () => {
  it('evens out serve-first across a round-robin (fixes the fixed-position bias)', () => {
    // Circle-method-style rounds where "a" is always listed first (position 0 bias).
    const rounds: Array<Array<[string, string]>> = [
      [['a', 'b']],
      [['a', 'c']],
      [['a', 'd']],
      [['a', 'e']],
    ]
    const balanced = balanceServeOrder(rounds)
    const firstCounts = new Map<string, number>()
    for (const round of balanced) for (const [first] of round) {
      firstCounts.set(first, (firstCounts.get(first) ?? 0) + 1)
    }
    // 'a' should no longer serve first in all 4 — it gets spread out.
    expect(firstCounts.get('a')).toBeLessThan(4)
  })

  it('every side still appears; only order changes', () => {
    const rounds: Array<Array<[string, string]>> = [
      [['a', 'b'], ['c', 'd']],
      [['a', 'c'], ['b', 'd']],
    ]
    const balanced = balanceServeOrder(rounds)
    const flatOrig = rounds.flat().map((p) => [...p].sort().join('-')).sort()
    const flatNew = balanced.flat().map((p) => [...p].sort().join('-')).sort()
    expect(flatNew).toEqual(flatOrig) // same matchups, possibly reordered
  })
})
