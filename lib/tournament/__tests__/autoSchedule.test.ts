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
