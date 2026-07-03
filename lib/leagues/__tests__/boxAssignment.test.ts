import { describe, it, expect } from 'vitest'
import { assignBoxesByRating, chunkBoxes, type BoxEntrant } from '../boxAssignment'

const e = (id: string, rating: number | null): BoxEntrant => ({ registrationId: id, rating })

describe('assignBoxesByRating', () => {
  it('chunks by rating, strongest in box 1 (tier_rank 1)', () => {
    const boxes = assignBoxesByRating(
      [e('c', 3.0), e('a', 4.5), e('d', 2.5), e('b', 4.0)],
      2,
    )
    expect(boxes.map(b => b.tierRank)).toEqual([1, 2])
    expect(boxes[0].members.map(m => m.registrationId)).toEqual(['a', 'b'])
    expect(boxes[1].members.map(m => m.registrationId)).toEqual(['c', 'd'])
    // seed_in_box is 1-based within each box
    expect(boxes[0].members.map(m => m.seedInBox)).toEqual([1, 2])
  })

  it('puts unrated entrants last', () => {
    const boxes = assignBoxesByRating([e('rated', 3.0), e('unrated', null)], 5)
    expect(boxes[0].members.map(m => m.registrationId)).toEqual(['rated', 'unrated'])
  })

  it('folds a trailing lone-player box up into the previous box', () => {
    // 5 entrants, box size 2 → [2,2,1]; the size-1 box folds up → [2,3]
    const boxes = assignBoxesByRating(
      [e('a', 5.0), e('b', 4.5), e('c', 4.0), e('d', 3.5), e('e', 3.0)],
      2,
    )
    expect(boxes.length).toBe(2)
    expect(boxes[0].members.map(m => m.registrationId)).toEqual(['a', 'b'])
    expect(boxes[1].members.map(m => m.registrationId)).toEqual(['c', 'd', 'e'])
    expect(boxes[1].members.map(m => m.seedInBox)).toEqual([1, 2, 3])
  })

  it('handles a field smaller than one box', () => {
    const boxes = assignBoxesByRating([e('a', 4.0), e('b', 3.0)], 5)
    expect(boxes.length).toBe(1)
    expect(boxes[0].members.length).toBe(2)
  })

  it('clamps a nonsense box size to a minimum of 2', () => {
    // size 0 → clamped to 2; 4 entrants → two boxes of 2
    const boxes = assignBoxesByRating([e('a', 4), e('b', 3.5), e('c', 3), e('d', 2.5)], 0)
    expect(boxes.length).toBe(2)
    expect(boxes.every(b => b.members.length === 2)).toBe(true)
  })
})

describe('chunkBoxes', () => {
  it('preserves the given order (no rating sort)', () => {
    // Intentionally out of rating order — a hand-seeded roster must persist as-is.
    const boxes = chunkBoxes(['d', 'a', 'c', 'b'], 2)
    expect(boxes[0].members.map(m => m.registrationId)).toEqual(['d', 'a'])
    expect(boxes[1].members.map(m => m.registrationId)).toEqual(['c', 'b'])
  })

  it('folds a trailing lone box up', () => {
    const boxes = chunkBoxes(['a', 'b', 'c', 'd', 'e'], 2)
    expect(boxes.length).toBe(2)
    expect(boxes[1].members.map(m => m.registrationId)).toEqual(['c', 'd', 'e'])
  })
})
