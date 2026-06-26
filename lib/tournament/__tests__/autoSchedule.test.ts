import { describe, it, expect } from 'vitest'
import { buildAutoSchedule, type AutoScheduleMatch, type OccupiedSlot } from '../autoSchedule'

const m = (id: string, round: number, num: number): AutoScheduleMatch => ({
  id, round_number: round, match_number: num,
})

// "court|HH:MM" key for asserting no two assignments share a cell.
const cell = (court: number, iso: string) => `${court}|${iso.slice(11, 16)}`

describe('buildAutoSchedule', () => {
  it('packs courts 1..N from the start time, staggering rounds (no occupancy)', () => {
    const matches = [m('a', 1, 1), m('b', 1, 2), m('c', 2, 1)]
    const out = buildAutoSchedule(matches, '2026-07-08', '08:00', 2, 30)
    const byId = Object.fromEntries(out.map(o => [o.id, o]))
    expect(byId.a).toMatchObject({ court_number: 1, scheduled_time: '2026-07-08T08:00:00-07:00' })
    expect(byId.b).toMatchObject({ court_number: 2, scheduled_time: '2026-07-08T08:00:00-07:00' })
    // round 2 starts after round 1's slot clears
    expect(byId.c).toMatchObject({ court_number: 1, scheduled_time: '2026-07-08T08:30:00-07:00' })
  })

  it('overflows to the next time slot when a round has more matches than courts', () => {
    const matches = [m('a', 1, 1), m('b', 1, 2), m('c', 1, 3)]
    const out = buildAutoSchedule(matches, '2026-07-08', '08:00', 2, 30)
    const byId = Object.fromEntries(out.map(o => [o.id, o]))
    expect(byId.a.scheduled_time).toBe('2026-07-08T08:00:00-07:00')
    expect(byId.b.scheduled_time).toBe('2026-07-08T08:00:00-07:00')
    expect(byId.c).toMatchObject({ court_number: 1, scheduled_time: '2026-07-08T08:30:00-07:00' })
  })

  it('skips a court+time already taken by another division', () => {
    const occupied: OccupiedSlot[] = [
      { court_number: 1, start_ms: Date.parse('2026-07-08T08:00:00-07:00') },
    ]
    const out = buildAutoSchedule([m('a', 1, 1)], '2026-07-08', '08:00', 2, 30, occupied)
    // court 1 @ 08:00 is busy → first free is court 2
    expect(out[0]).toMatchObject({ court_number: 2, scheduled_time: '2026-07-08T08:00:00-07:00' })
  })

  it('never double-books a court across two divisions scheduled in sequence', () => {
    const divA = [m('a1', 1, 1), m('a2', 1, 2), m('a3', 2, 1)]
    const divB = [m('b1', 1, 1), m('b2', 1, 2), m('b3', 2, 1)]

    const outA = buildAutoSchedule(divA, '2026-07-08', '08:00', 2, 30)
    // Division B sees A's assignments as occupied.
    const occ: OccupiedSlot[] = outA.map(a => ({
      court_number: a.court_number, start_ms: Date.parse(a.scheduled_time),
    }))
    const outB = buildAutoSchedule(divB, '2026-07-08', '08:00', 2, 30, occ)

    const cells = [...outA, ...outB].map(o => cell(o.court_number, o.scheduled_time))
    expect(new Set(cells).size).toBe(cells.length) // all distinct → no double-booking
  })
})

// match with a stage — for elimination brackets where round_number resets per stage.
const ms = (id: string, stage: string, round: number, num: number): AutoScheduleMatch => ({
  id, match_stage: stage, round_number: round, match_number: num,
})
const hhmm = (iso: string) => iso.slice(11, 16)

describe('buildAutoSchedule — double elimination dependency levels', () => {
  // 4-team double elim: WB has R1 (2 semis) + R2 (final); LB has R1 + R2 (final);
  // then the Championship. Plenty of courts + 60-min slots so each level is one hour.
  const bracket = [
    ms('wb1', 'winners_bracket', 1, 1),
    ms('wb2', 'winners_bracket', 1, 2),
    ms('wbf', 'winners_bracket', 2, 3),
    ms('lb1', 'losers_bracket', 1, 4),
    ms('lbf', 'losers_bracket', 2, 5),
    ms('champ', 'championship', 1, 6),
  ]

  it('floors the Championship after the WB Final and LB Final — not at the semis slot', () => {
    const out = buildAutoSchedule(bracket, '2026-06-27', '08:00', 4, 60)
    const t = Object.fromEntries(out.map(o => [o.id, hhmm(o.scheduled_time)]))
    // WB semis first
    expect(t.wb1).toBe('08:00')
    expect(t.wb2).toBe('08:00')
    // WB final + LB R1 (both fed by the semis) next
    expect(t.wbf).toBe('09:00')
    expect(t.lb1).toBe('09:00')
    // LB final after LB R1, then the Championship strictly last
    expect(t.lbf).toBe('10:00')
    expect(t.champ).toBe('11:00')
    // The reported bug: champ must NOT share the semis' 08:00 slot.
    expect(t.champ).not.toBe(t.wb1)
  })
})

describe('buildAutoSchedule — round-robin "double-elim final" playoffs', () => {
  // The playoffs stage holds the semis; the final was converted to a championship.
  const playoff = [
    ms('s1', 'playoffs', 1, 1),
    ms('s2', 'playoffs', 1, 2),
    ms('final', 'championship', 1, 3),
  ]

  it('schedules the championship final after the playoff semis', () => {
    const out = buildAutoSchedule(playoff, '2026-06-27', '08:00', 4, 60)
    const t = Object.fromEntries(out.map(o => [o.id, hhmm(o.scheduled_time)]))
    expect(t.s1).toBe('08:00')
    expect(t.s2).toBe('08:00')
    expect(t.final).toBe('09:00')
  })
})
