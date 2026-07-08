import { describe, it, expect } from 'vitest'
import { rankEntities, type RankMatch } from '../standings'

// The entity-agnostic ranking core, exercised with opaque (team-style) ids — proving it
// ranks any entity, not just registrations. Same rules the registration path uses.
const m = (a: string, b: string, sa: number, sb: number): RankMatch => ({
  sideAId: a, sideBId: b, scoreA: sa, scoreB: sb, winnerId: sa > sb ? a : b,
})
const ids = (rows: { entityId: string }[]) => rows.map(r => r.entityId)

describe('rankEntities', () => {
  it('orders by win percentage first', () => {
    const rows = rankEntities([
      m('A', 'B', 11, 5), m('A', 'C', 11, 7), // A 2-0
      m('B', 'C', 11, 9),                      // B 1-1, C 0-2
    ], ['A', 'B', 'C'])
    expect(ids(rows)).toEqual(['A', 'B', 'C'])
  })

  it('breaks equal win% by point differential', () => {
    const rows = rankEntities([
      m('A', 'X', 11, 2), m('A', 'Y', 3, 11),  // A 1-1, diff 0? (11-2)+(3-11)=+1
      m('B', 'X', 11, 9), m('B', 'Y', 4, 11),  // B 1-1, diff (11-9)+(4-11)=-5
    ], ['A', 'B', 'X', 'Y'])
    // A and B both 1-1; A has the better differential → A above B
    expect(ids(rows).indexOf('A')).toBeLessThan(ids(rows).indexOf('B'))
  })

  it('breaks a full (win%, diff) tie by head-to-head', () => {
    // A and B are both 1-1 with identical overall differential (-4); A beat B head-to-head,
    // so A ranks above B. X and Y are 1-0 and sit above the tied pair.
    const rows = rankEntities([
      m('A', 'B', 11, 9),   // A beats B  (A: +2 h2h)
      m('X', 'A', 11, 5),   // X beats A  (A other: -6 → A total 1-1, diff -4)
      m('Y', 'B', 11, 9),   // Y beats B  (B other: -2 → B total 1-1, diff -4)
    ], ['A', 'B', 'X', 'Y'])
    expect(ids(rows).indexOf('A')).toBeLessThan(ids(rows).indexOf('B'))
  })

  it('seeds 0–0 entities and orders them by name', () => {
    const rows = rankEntities([], ['t2', 't1', 't3'], (id) => ({ t1: 'Alpha', t2: 'Bravo', t3: 'Charlie' }[id] ?? id))
    // all 0–0 → sorted by name Alpha < Bravo < Charlie
    expect(ids(rows)).toEqual(['t1', 't2', 't3'])
  })

  it('lazily includes entities that appear only in matches', () => {
    const rows = rankEntities([m('A', 'B', 11, 0)], ['A']) // B not seeded
    expect(ids(rows).sort()).toEqual(['A', 'B'])
    expect(rows.find(r => r.entityId === 'B')!.losses).toBe(1)
  })
})
