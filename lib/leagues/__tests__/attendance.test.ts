import { describe, it, expect } from 'vitest'
import { buildAttendeeRows, type AttendeeInput } from '../attendance'

describe('buildAttendeeRows', () => {
  it('resolves the substitute overlay both ways by registration', () => {
    const inputs: AttendeeInput[] = [
      { id: 'r1', displayName: 'Abraham Dyer', kind: 'roster', status: 'has_sub', registrationId: 'regA' },
      { id: 'r2', displayName: 'Bonnie Booker', kind: 'roster', status: 'present', registrationId: 'regB' },
      { id: 's1', displayName: 'Heidi Reed', kind: 'sub', status: 'present', subbingForRegistrationId: 'regA' },
    ]
    const { roster, subs } = buildAttendeeRows(inputs)

    expect(roster).toHaveLength(2)
    expect(subs).toHaveLength(1)
    // covered member shows who is covering
    expect(roster.find(r => r.id === 'r1')?.subbedByName).toBe('Heidi Reed')
    // uncovered member has no sub label
    expect(roster.find(r => r.id === 'r2')?.subbedByName).toBeUndefined()
    // the sub shows the member it covers
    expect(subs[0].coveringName).toBe('Abraham Dyer')
  })

  it('keeps guests separate with no coverage linkage', () => {
    const inputs: AttendeeInput[] = [
      { id: 'r1', displayName: 'Cedric Gibbs', kind: 'roster', status: 'present', registrationId: 'regC' },
      { id: 'g1', displayName: 'Walk-on Guest', kind: 'guest', status: 'present' },
    ]
    const { roster, subs } = buildAttendeeRows(inputs)
    expect(roster.map(r => r.id)).toEqual(['r1'])
    expect(subs.map(s => s.id)).toEqual(['g1'])
    expect(subs[0].kind).toBe('guest')
    expect(subs[0].coveringName).toBeUndefined()
  })

  it('carries team + self-report labels through onto roster rows', () => {
    const { roster } = buildAttendeeRows([
      { id: 'r1', displayName: 'Nash', kind: 'roster', status: 'coming', registrationId: 'regN', teamName: 'Team A', selfReportBadge: 'Cmg' },
    ])
    expect(roster[0].teamName).toBe('Team A')
    expect(roster[0].selfReportBadge).toBe('Cmg')
  })
})
