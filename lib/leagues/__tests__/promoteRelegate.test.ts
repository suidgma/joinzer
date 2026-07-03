import { describe, it, expect } from 'vitest'
import { applyPromotionRelegation, type StandingBox } from '../promoteRelegate'

describe('applyPromotionRelegation', () => {
  it('promotes the top and relegates the bottom by one tier', () => {
    const boxes: StandingBox[] = [
      { tierRank: 1, memberIds: ['A', 'B', 'C'] }, // A best
      { tierRank: 2, memberIds: ['D', 'E', 'F'] }, // D best
    ]
    const next = applyPromotionRelegation(boxes, 1, 1)
    // Box 1: keeps A,B; loses C down; gains D (promoted, goes to top)
    expect(next[0]).toEqual({ tierRank: 1, memberIds: ['D', 'A', 'B'] })
    // Box 2: keeps E,F; gains C (relegated, goes to bottom); D left
    expect(next[1]).toEqual({ tierRank: 2, memberIds: ['E', 'F', 'C'] })
  })

  it('never promotes out of the top box or relegates out of the bottom box', () => {
    const boxes: StandingBox[] = [
      { tierRank: 1, memberIds: ['A', 'B'] },
      { tierRank: 2, memberIds: ['C', 'D'] },
    ]
    const next = applyPromotionRelegation(boxes, 1, 1)
    // A (top of top box) can't promote; D (bottom of bottom box) can't relegate.
    expect(next[0].memberIds).toContain('A')
    expect(next[1].memberIds).toContain('D')
    // B relegates down, C promotes up
    expect(next[0].memberIds).toEqual(['C', 'A']) // C promoted to top, A stays
    expect(next[1].memberIds).toEqual(['D', 'B']) // D stays, B relegated to bottom
  })

  it('is a no-op with promote/relegate 0', () => {
    const boxes: StandingBox[] = [
      { tierRank: 1, memberIds: ['A', 'B'] },
      { tierRank: 2, memberIds: ['C', 'D'] },
    ]
    const next = applyPromotionRelegation(boxes, 0, 0)
    expect(next).toEqual(boxes)
  })

  it('handles three tiers — middle box swaps with both neighbours', () => {
    const boxes: StandingBox[] = [
      { tierRank: 1, memberIds: ['A', 'B', 'C'] },
      { tierRank: 2, memberIds: ['D', 'E', 'F'] },
      { tierRank: 3, memberIds: ['G', 'H', 'I'] },
    ]
    const next = applyPromotionRelegation(boxes, 1, 1)
    // tier 2 gains C (from box1 bottom) + G (from box3 top), keeps E, loses D up + F down
    expect(next[1].memberIds).toEqual(['G', 'E', 'C'])
  })
})
