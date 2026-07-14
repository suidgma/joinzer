import { describe, it, expect } from 'vitest'
import {
  normalizeVenueName,
  diceCoefficient,
  tokenSimilarity,
  nameSimilarity,
  haversineMeters,
  findDuplicateCandidates,
  type VenueLike,
} from '../duplicates'

const v = (id: string, over: Partial<VenueLike> = {}): VenueLike => ({
  id,
  name: 'Venue',
  status: 'approved',
  ...over,
})

describe('normalizeVenueName', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeVenueName('  AAA   Test!! Courts ')).toBe('aaa test courts')
    expect(normalizeVenueName("O'Callaghan Park")).toBe('o callaghan park')
  })
})

describe('name similarity', () => {
  it('treats extra whitespace/case as identical', () => {
    expect(nameSimilarity('AAA Test', 'aaa  test')).toBe(1)
  })

  it('scores minor spelling differences high but < 1', () => {
    const s = diceCoefficient('Sunset Park', 'Sunsett Park')
    expect(s).toBeGreaterThan(0.7)
    expect(s).toBeLessThan(1)
  })

  it('token overlap catches filler-word supersets', () => {
    // Dice is dragged down by the extra words; token similarity rescues it.
    expect(tokenSimilarity('Sunset Park', 'Sunset Park Pickleball Courts')).toBe(1)
    expect(nameSimilarity('Sunset Park', 'Sunset Park Pickleball Courts')).toBe(1)
  })

  it('does not over-match unrelated venues', () => {
    expect(nameSimilarity('Sunset Park', 'Green Valley Rec')).toBeLessThan(0.3)
  })
})

describe('haversineMeters', () => {
  it('is ~0 for the same point', () => {
    expect(haversineMeters(36.1, -115.1, 36.1, -115.1)).toBeCloseTo(0, 5)
  })

  it('approximates a known short distance', () => {
    // ~0.001 deg latitude ≈ 111 m
    const d = haversineMeters(36.1, -115.1, 36.101, -115.1)
    expect(d).toBeGreaterThan(100)
    expect(d).toBeLessThan(120)
  })
})

describe('findDuplicateCandidates', () => {
  it('excludes the target itself', () => {
    const target = v('t', { name: 'AAA Test' })
    const res = findDuplicateCandidates(target, [target])
    expect(res).toHaveLength(0)
  })

  it('flags a near-identical name', () => {
    const target = v('t', { name: 'AAA Test' })
    const pool = [v('a', { name: 'AAA  Test' }), v('b', { name: 'Completely Different' })]
    const res = findDuplicateCandidates(target, pool)
    expect(res.map((r) => r.id)).toEqual(['a'])
    expect(res[0].reasons).toContain('Nearly identical name')
  })

  it('flags a nearby venue even with a different name', () => {
    const target = v('t', { name: 'Court A', lat: 36.1, lng: -115.1 })
    const pool = [v('near', { name: 'Court B', lat: 36.1005, lng: -115.1 })]
    const res = findDuplicateCandidates(target, pool)
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('near')
    expect(res[0].reasons.some((r) => r.endsWith('m away'))).toBe(true)
  })

  it('does not flag a far-away, differently-named venue', () => {
    const target = v('t', { name: 'Court A', lat: 36.1, lng: -115.1, zip_code: '89000' })
    const pool = [v('far', { name: 'Court B', lat: 40.0, lng: -120.0, zip_code: '90000' })]
    expect(findDuplicateCandidates(target, pool)).toHaveLength(0)
  })

  it('uses a shared ZIP + weak name overlap to qualify', () => {
    const target = v('t', { name: 'Sunset Park', zip_code: '89012' })
    const pool = [v('z', { name: 'Sunset Fields', zip_code: '89012' })]
    const res = findDuplicateCandidates(target, pool)
    expect(res).toHaveLength(1)
    expect(res[0].reasons).toContain('Same ZIP')
  })

  it('ranks by score and respects the limit', () => {
    const target = v('t', { name: 'AAA Test' })
    const pool = [
      v('exact', { name: 'AAA Test' }),
      v('close', { name: 'AAA Testt' }),
      v('weak', { name: 'AAA Testing Grounds' }),
      v('nope', { name: 'Zzz Other' }),
    ]
    const res = findDuplicateCandidates(target, pool, { limit: 2 })
    expect(res).toHaveLength(2)
    expect(res[0].id).toBe('exact')
    expect(res[0].score).toBeGreaterThanOrEqual(res[1].score)
  })

  it('carries status through so the UI can label approved vs pending', () => {
    const target = v('t', { name: 'AAA Test' })
    const pool = [v('p', { name: 'AAA Test', status: 'pending' })]
    expect(findDuplicateCandidates(target, pool)[0].status).toBe('pending')
  })
})
