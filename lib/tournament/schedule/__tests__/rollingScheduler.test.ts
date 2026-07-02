import { describe, it, expect } from 'vitest'
import { buildRollingSchedule } from '../rollingScheduler'
import { assignSequenceInOrder, assignSequenceTimed } from '../assignSequence'
import type { SchedulableMatch } from '../../scheduleGenerator'

const m = (over: Partial<SchedulableMatch>): SchedulableMatch => ({
  division_id: 'd1', round_number: 1, match_number: 1, match_stage: 'round_robin', ...over,
})

describe('buildRollingSchedule — round-robin court distribution', () => {
  const rr = Array.from({ length: 24 }, (_, i) => m({ match_number: i + 1 }))
  const ordered = buildRollingSchedule({ court_numbers: [1, 2, 3, 4, 5, 6], matches: rr })
  assignSequenceInOrder(ordered)

  it('spreads matches across courts round-robin (Court 1 = play-order 1,7,13,19)', () => {
    const ct1 = ordered.filter(x => x.court_number === 1).map(x => x.sequence_number).sort((a, b) => a! - b!)
    expect(ct1).toEqual([1, 7, 13, 19])
    const ct2 = ordered.filter(x => x.court_number === 2).map(x => x.sequence_number).sort((a, b) => a! - b!)
    expect(ct2).toEqual([2, 8, 14, 20])
  })

  it('court = ((sequence-1) mod courtCount) + 1 for every match', () => {
    for (const x of ordered) expect(x.court_number).toBe(((x.sequence_number! - 1) % 6) + 1)
  })

  it('assigns NO times — court set, scheduled_time / scheduled_end_time null', () => {
    expect(ordered.every(x => x.court_number != null && x.scheduled_time === null && x.scheduled_end_time === null)).toBe(true)
  })

  it('sequence is dense 1..N', () => {
    expect([...ordered].map(x => x.sequence_number).sort((a, b) => a! - b!)).toEqual(
      Array.from({ length: 24 }, (_, i) => i + 1),
    )
  })
})

describe('buildRollingSchedule — dependency order (single elim)', () => {
  const se = [
    ...[1, 2, 3, 4].map(n => m({ match_number: n, round_number: 1, match_stage: 'single_elimination' })),
    ...[5, 6].map(n => m({ match_number: n, round_number: 2, match_stage: 'single_elimination' })),
    m({ match_number: 7, round_number: 3, match_stage: 'single_elimination' }),
  ]
  const ordered = buildRollingSchedule({ court_numbers: [1, 2], matches: se })
  assignSequenceInOrder(ordered)
  const seqOf = (r: number) => ordered.filter(x => x.round_number === r).map(x => x.sequence_number!)

  it('numbers round 1 before round 2 before the final', () => {
    expect(Math.max(...seqOf(1))).toBeLessThan(Math.min(...seqOf(2)))
    expect(Math.max(...seqOf(2))).toBeLessThan(seqOf(3)[0])
  })
})

describe('buildRollingSchedule — double elim championship is last', () => {
  const de = [
    m({ match_number: 1, round_number: 1, match_stage: 'winners_bracket' }),
    m({ match_number: 2, round_number: 1, match_stage: 'winners_bracket' }),
    m({ match_number: 3, round_number: 2, match_stage: 'winners_bracket' }),
    m({ match_number: 4, round_number: 1, match_stage: 'losers_bracket' }),
    m({ match_number: 5, round_number: 2, match_stage: 'losers_bracket' }),
    m({ match_number: 6, round_number: 1, match_stage: 'championship' }),
  ]
  const ordered = buildRollingSchedule({ court_numbers: [1, 2], matches: de })
  assignSequenceInOrder(ordered)

  it('the championship gets the highest sequence', () => {
    const champ = ordered.find(x => x.match_stage === 'championship')!.sequence_number!
    const rest = ordered.filter(x => x.match_stage !== 'championship').map(x => x.sequence_number!)
    expect(champ).toBeGreaterThan(Math.max(...rest))
  })
})

describe('assignSequenceInOrder — idempotent for a fixed order', () => {
  it('re-running on the same array reproduces the sequence', () => {
    const rows = [1, 2, 3, 4].map(n => m({ match_number: n }))
    assignSequenceInOrder(rows)
    const first = rows.map(x => x.sequence_number)
    assignSequenceInOrder(rows)
    expect(rows.map(x => x.sequence_number)).toEqual(first)
    expect(first).toEqual([1, 2, 3, 4])
  })
})

describe('assignSequenceTimed — orders by (time, court)', () => {
  it('earliest start first; ties broken by court', () => {
    const rows = [
      m({ match_number: 3, scheduled_time: '2026-07-01T09:00:00-07:00', court_number: 2 }),
      m({ match_number: 1, scheduled_time: '2026-07-01T08:00:00-07:00', court_number: 1 }),
      m({ match_number: 2, scheduled_time: '2026-07-01T08:00:00-07:00', court_number: 2 }),
    ]
    assignSequenceTimed(rows)
    const seqByMatch = new Map(rows.map(x => [x.match_number, x.sequence_number]))
    expect(seqByMatch.get(1)).toBe(1) // 8:00 Ct1
    expect(seqByMatch.get(2)).toBe(2) // 8:00 Ct2
    expect(seqByMatch.get(3)).toBe(3) // 9:00 Ct2
  })
})
