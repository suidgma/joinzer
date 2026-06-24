import { describe, it, expect } from 'vitest'
import {
  divisionConcurrency,
  effectiveBlockCourts,
  estimateBlockFinishMinutes,
  blockCapacity,
  minutesToLabel,
} from '../scheduleEstimates'
import type { ScheduleSettings } from '@/lib/types'

const settings: ScheduleSettings = {
  match_duration_minutes: 30,
  buffer_minutes: 0,
  min_rest_minutes: 0,
  conflict_policy: 'warning',
  keep_divisions_grouped: true,
  allow_division_overlap: true,
  allow_court_sharing: true,
  schedule_by_priority: false,
  leave_end_buffer: false,
  end_buffer_minutes: 0,
}

describe('divisionConcurrency', () => {
  it('is floor(entrants / 2) — two sides per match', () => {
    expect(divisionConcurrency(20)).toBe(10) // 20 singles players → 10 matches
    expect(divisionConcurrency(10)).toBe(5)  // 10 doubles teams → 5 matches
    expect(divisionConcurrency(1)).toBe(0)
    expect(divisionConcurrency(0)).toBe(0)
  })
})

describe('effectiveBlockCourts', () => {
  it('caps courts by player availability', () => {
    // 20 singles players in a 14-court block → only 10 courts usable
    expect(effectiveBlockCourts(14, [20])).toBe(10)
  })

  it('stays court-limited when there are enough players', () => {
    // 40 players → 20 match ceiling, but only 6 courts
    expect(effectiveBlockCourts(6, [40])).toBe(6)
  })

  it('sums the ceiling across divisions', () => {
    expect(effectiveBlockCourts(14, [20, 8])).toBe(14) // 10 + 4 = 14
    expect(effectiveBlockCourts(14, [20, 6])).toBe(13) // 10 + 3 = 13
  })

  it('falls back to the court count when no team data is present', () => {
    expect(effectiveBlockCourts(14, [])).toBe(14)
    expect(effectiveBlockCourts(14, [0, 0])).toBe(14)
  })
})

describe('estimateBlockFinishMinutes with the player ceiling', () => {
  // The reported bug: afternoon block 1:00 PM–9:00 PM, 14 courts, one division of
  // 20 singles players, 190 matches. Only 10 courts can run at once.
  it('uses 10 effective courts, not 14, so the finish is realistic', () => {
    const start = '13:00'
    const matches = 190
    const eff = effectiveBlockCourts(14, [20])
    expect(eff).toBe(10)

    const finishWrong = estimateBlockFinishMinutes(14, start, matches, settings)
    const finishRight = estimateBlockFinishMinutes(eff, start, matches, settings)

    // 14 courts → ceil(190/14)=14 waves × 30 = 420 min → 8:00 PM (the old, wrong value)
    expect(minutesToLabel(finishWrong!)).toBe('8:00 PM')
    // 10 courts → ceil(190/10)=19 waves × 30 = 570 min → 10:30 PM (correct)
    expect(minutesToLabel(finishRight!)).toBe('10:30 PM')
  })

  it('capacity reflects the player ceiling too (block is actually over)', () => {
    const eff = effectiveBlockCourts(14, [20])
    const cap = blockCapacity(eff, '13:00', '21:00', settings).matchCapacity
    // 10 courts × 480 min / 30 = 160 slots → 190 matches overflows
    expect(cap).toBe(160)
    expect(190 > cap).toBe(true)
  })
})
