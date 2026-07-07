import { describe, it, expect } from 'vitest'
import { scoreToLevel, provisionalScoreFromSelfReport, selfReportedLevel } from '../levels'

describe('scoreToLevel (pickleball)', () => {
  it('maps each band to its label', () => {
    expect(scoreToLevel('pickleball', 0)).toBe('New Player')
    expect(scoreToLevel('pickleball', 20)).toBe('New Player')
    expect(scoreToLevel('pickleball', 21)).toBe('Beginner')
    expect(scoreToLevel('pickleball', 40)).toBe('Beginner')
    expect(scoreToLevel('pickleball', 41)).toBe('Intermediate')
    expect(scoreToLevel('pickleball', 60)).toBe('Intermediate')
    expect(scoreToLevel('pickleball', 61)).toBe('Advanced')
    expect(scoreToLevel('pickleball', 80)).toBe('Advanced')
    expect(scoreToLevel('pickleball', 81)).toBe('Elite')
    expect(scoreToLevel('pickleball', 100)).toBe('Elite')
  })

  it('clamps out-of-range scores', () => {
    expect(scoreToLevel('pickleball', -10)).toBe('New Player')
    expect(scoreToLevel('pickleball', 250)).toBe('Elite')
  })
})

describe('provisionalScoreFromSelfReport', () => {
  it('anchors 2.0→20, 3.5→55, 5.0→90', () => {
    expect(provisionalScoreFromSelfReport(2.0)).toBe(20)
    expect(provisionalScoreFromSelfReport(3.5)).toBe(55)
    expect(provisionalScoreFromSelfReport(5.0)).toBe(90)
  })

  it('returns null for no self-report', () => {
    expect(provisionalScoreFromSelfReport(null)).toBeNull()
    expect(provisionalScoreFromSelfReport(undefined)).toBeNull()
  })

  it('clamps very high ratings to 100', () => {
    expect(provisionalScoreFromSelfReport(8.0)).toBe(100)
  })
})

describe('selfReportedLevel', () => {
  it('matches the documented examples', () => {
    expect(selfReportedLevel(3.5)).toBe('Intermediate') // the doc example
    expect(selfReportedLevel(2.5)).toBe('Beginner')
    expect(selfReportedLevel(4.0)).toBe('Advanced')
    expect(selfReportedLevel(5.0)).toBe('Elite')
  })

  it('falls back to New Player without a self-report', () => {
    expect(selfReportedLevel(null)).toBe('New Player')
  })
})
