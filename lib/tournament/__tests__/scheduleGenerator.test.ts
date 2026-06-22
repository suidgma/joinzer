/**
 * Unit tests for scheduleBlockMatches() in scheduleGenerator.ts.
 *
 * The block packer assigns a court + start time to every draft match. Its hard
 * correctness invariant: a later-round match must never start before the matches
 * that feed it have finished. Elimination "winner-of" matches carry null team
 * IDs, so the per-team rest gate can't hold them back — only the per-division
 * phase floor can. These tests pin that behavior so we don't regress to the
 * "TBD vs TBD scheduled at the same time as round 1" bug.
 */

import { describe, it, expect } from 'vitest'
import { scheduleBlockMatches, type SchedulableMatch, type BlockWindow } from '../scheduleGenerator'
import type { ScheduleSettings } from '@/lib/types'

// Inlined defaults — kept in sync with DEFAULT_SCHEDULE_SETTINGS. Imported as a
// value path the vitest runtime can't alias-resolve, so we declare it here.
const DEFAULT_SCHEDULE_SETTINGS: ScheduleSettings = {
  match_duration_minutes: 25,
  buffer_minutes: 5,
  min_rest_minutes: 10,
  conflict_policy: 'warning',
  keep_divisions_grouped: true,
  allow_division_overlap: true,
  allow_court_sharing: true,
  schedule_by_priority: false,
  leave_end_buffer: false,
  end_buffer_minutes: 0,
}

const block: BlockWindow = {
  block_date: '2026-07-08',
  start_time: '08:00',
  end_time: '17:00',
  court_numbers: [1, 2, 3, 4, 5, 6, 7, 8],
}

// Minutes-from-midnight for a scheduled ISO like '2026-07-08T08:30:00-07:00'.
function startMin(iso: string | null | undefined): number {
  const t = iso!.slice(11, 16).split(':').map(Number)
  return t[0] * 60 + t[1]
}
function endMin(m: SchedulableMatch): number {
  return startMin(m.scheduled_end_time)
}

function elim(divisionId: string, stage: string, round: number, n: number, teamed: boolean): SchedulableMatch {
  return {
    division_id: divisionId,
    match_stage: stage,
    round_number: round,
    match_number: n,
    team_1_registration_id: teamed ? `${divisionId}-t${n}a` : null,
    team_2_registration_id: teamed ? `${divisionId}-t${n}b` : null,
  }
}

describe('scheduleBlockMatches dependency floor', () => {
  it('starts a later round only after the earlier round of the same division finishes', () => {
    // 4-team single elim: round 1 = 2 real matches, round 2 (final) = 1 TBD-vs-TBD.
    const r1a = elim('D', 'single_elimination', 1, 1, true)
    const r1b = elim('D', 'single_elimination', 1, 2, true)
    const final = elim('D', 'single_elimination', 2, 3, false) // winner-of vs winner-of

    scheduleBlockMatches(block, [r1a, r1b, final], DEFAULT_SCHEDULE_SETTINGS)

    const r1End = Math.max(endMin(r1a), endMin(r1b))
    expect(startMin(final.scheduled_time)).toBeGreaterThanOrEqual(r1End)
  })

  it('does not co-schedule a winner-of match with its feeders', () => {
    const r1 = [1, 2, 3, 4].map(n => elim('D', 'winners_bracket', 1, n, true))
    const r2 = [5, 6].map(n => elim('D', 'winners_bracket', 2, n, false))
    const all = [...r1, ...r2]

    scheduleBlockMatches(block, all, DEFAULT_SCHEDULE_SETTINGS)

    const r1End = Math.max(...r1.map(endMin))
    for (const m of r2) {
      expect(startMin(m.scheduled_time)).toBeGreaterThanOrEqual(r1End)
    }
  })

  it('schedules the losers bracket after the winners bracket (cross-stage dependency)', () => {
    const wb = [1, 2, 3, 4].map(n => elim('D', 'winners_bracket', 1, n, true))
    const lb = [5, 6].map(n => elim('D', 'losers_bracket', 1, n, false))

    scheduleBlockMatches(block, [...wb, ...lb], DEFAULT_SCHEDULE_SETTINGS)

    const wbEnd = Math.max(...wb.map(endMin))
    for (const m of lb) {
      expect(startMin(m.scheduled_time)).toBeGreaterThanOrEqual(wbEnd)
    }
  })

  it('never double-books a court at the same start time', () => {
    const matches = [1, 2, 3, 4].map(n => elim('D', 'winners_bracket', 1, n, true))
    scheduleBlockMatches(block, matches, DEFAULT_SCHEDULE_SETTINGS)

    const slots = new Set<string>()
    for (const m of matches) {
      const key = `${m.court_number}@${m.scheduled_time}`
      expect(slots.has(key)).toBe(false)
      slots.add(key)
    }
  })

  it('keeps a small division on its own courts for later rounds', () => {
    // 4-team single elim: round 1 fills two courts; the final should reuse one of
    // them rather than spilling onto a fresh court to shave the turnaround buffer.
    const r1a = elim('D', 'single_elimination', 1, 1, true)
    const r1b = elim('D', 'single_elimination', 1, 2, true)
    const final = elim('D', 'single_elimination', 2, 3, false)

    scheduleBlockMatches(block, [r1a, r1b, final], DEFAULT_SCHEDULE_SETTINGS)

    const r1Courts = new Set([r1a.court_number, r1b.court_number])
    expect(r1Courts.has(final.court_number!)).toBe(true)
  })

  it('leaves an independent round-robin division on the early slots (no false floor)', () => {
    // A single-phase RR division should still pack from the block start.
    const rr: SchedulableMatch[] = [1, 2, 3, 4].map(n => ({
      division_id: 'RR',
      match_stage: 'round_robin',
      round_number: 1,
      match_number: n,
      team_1_registration_id: `rr-${n}a`,
      team_2_registration_id: `rr-${n}b`,
    }))
    scheduleBlockMatches(block, rr, DEFAULT_SCHEDULE_SETTINGS)

    const blockStart = 8 * 60
    expect(Math.min(...rr.map(m => startMin(m.scheduled_time)))).toBe(blockStart)
  })

  it('packs round-robin rounds in parallel — no inter-round floor', () => {
    // Round robin has no inter-round dependency: round 2 doesn't consume round 1's
    // results. With only 2 courts and null teams (no rest gate), a later round must
    // be free to fill a court the moment one opens, NOT wait for the whole previous
    // round to finish. Folding round_number into the phase (elimination's behavior)
    // would serialize them and idle courts — the bug this pins.
    const narrow: BlockWindow = { ...block, court_numbers: [1, 2] }
    const mk = (round: number, n: number): SchedulableMatch => ({
      division_id: 'RR', match_stage: 'round_robin', round_number: round, match_number: n,
      team_1_registration_id: null, team_2_registration_id: null,
    })
    const r1 = [1, 2, 3].map(n => mk(1, n))
    const r2 = [4, 5, 6].map(n => mk(2, n))
    scheduleBlockMatches(narrow, [...r1, ...r2], DEFAULT_SCHEDULE_SETTINGS)

    const r1End = Math.max(...r1.map(endMin))
    const r2Start = Math.min(...r2.map(m => startMin(m.scheduled_time)))
    expect(r2Start).toBeLessThan(r1End)
  })

  it('does not double-book a player across rotating-doubles matches (counts partners)', () => {
    // Two rotating-doubles matches share all four players, rotated between the team
    // and partner slots. The conflict gate must see the partner columns too — else a
    // player gets booked into two matches at once (the over-packing / stranded-court bug).
    const rot = (n: number, t1: string, t1p: string, t2: string, t2p: string): SchedulableMatch => ({
      division_id: 'RD', match_stage: 'round_robin', round_number: n, match_number: n,
      team_1_registration_id: t1, team_1_partner_registration_id: t1p,
      team_2_registration_id: t2, team_2_partner_registration_id: t2p,
    })
    const m1 = rot(1, 'p1', 'p2', 'p3', 'p4')
    const m2 = rot(2, 'p2', 'p1', 'p4', 'p3') // same four players, rotated slots
    scheduleBlockMatches(block, [m1, m2], DEFAULT_SCHEDULE_SETTINGS)

    // They share players, so the second can't start until the first has finished.
    expect(startMin(m2.scheduled_time)).toBeGreaterThanOrEqual(endMin(m1))
  })
})
