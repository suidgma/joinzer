import type { LeagueAttendanceStatus } from '../types'

// Player self-report (league_session_attendance.attendance_status) → organizer-grid actual_status
// (league_session_players.actual_status). ONE faithful mapping so the self-report route and the
// live-page seeding never drift again. A previous lossy variant collapsed cannot_attend →
// not_present and planning_to_attend → present, so a player's "Can't Come" self-report showed as
// "Not Here" on the organizer/host grid. Inverse of the actual_status → attendance map used when an
// organizer changes a player's status.
export function selfReportToActualStatus(selfStatus: string | null | undefined): string {
  switch (selfStatus) {
    case 'checked_in_present': return 'present'
    case 'planning_to_attend': return 'coming'
    case 'running_late':       return 'late'
    case 'cannot_attend':      return 'cannot_attend'
    default:                   return 'not_present' // not_responded / unknown
  }
}

// The shared attendance model (docs/phases/unified-attendance.md). These types are
// the contract between the data layer and the presentational AttendanceGrid, kept
// in lib so both the grid and per-format data helpers depend on the same shape.

// One row in the attendance grid, normalized across formats.
export type AttendeeRow = {
  /** Opaque row id — session_player id for round-robin, attendance/registration id elsewhere. */
  id: string
  displayName: string
  kind: 'roster' | 'sub' | 'guest'
  status: LeagueAttendanceStatus
  /** Fixed-partner grouping label (roster rows only). */
  teamName?: string
  /** Precomputed self-report badge, e.g. "Here" / "Cmg" / "Late" / "Out". */
  selfReportBadge?: string
  /** On a covered roster row (status 'has_sub'): who is covering. */
  subbedByName?: string
  /** On a sub row: the absent member they cover ("for X"). */
  coveringName?: string
}

// Raw attendee data (before the substitute overlay is resolved). Callers classify
// each attendee's `kind` and supply the registration linkage; buildAttendeeRows
// fills in subbedByName / coveringName by matching subs to covered members.
export type AttendeeInput = {
  id: string
  displayName: string
  kind: 'roster' | 'sub' | 'guest'
  status: LeagueAttendanceStatus
  /** The roster member's own registration (roster rows). */
  registrationId?: string | null
  /** Set on a sub/guest row: the registration it covers. */
  subbingForRegistrationId?: string | null
  teamName?: string
  selfReportBadge?: string
}

/**
 * Split attendees into the grid's roster + subs lists and resolve the substitute
 * overlay by registration: a covered roster member shows who is covering
 * (`subbedByName`); a sub shows the member it covers (`coveringName`). Pure and
 * format-agnostic — round-robin, box, and future formats all feed it.
 */
export function buildAttendeeRows(inputs: AttendeeInput[]): { roster: AttendeeRow[]; subs: AttendeeRow[] } {
  // covering attendees' names, keyed by the covered member's registration. A
  // doubles team is one entrant, so a whole-team sub links TWO covering rows to
  // the same registration — join them into "SubA/SubB".
  const coveringNamesByReg = new Map<string, string[]>()
  // covered roster member's name, keyed by their registration
  const rosterNameByReg = new Map<string, string>()
  for (const i of inputs) {
    if (i.subbingForRegistrationId) {
      const arr = coveringNamesByReg.get(i.subbingForRegistrationId) ?? []
      arr.push(i.displayName)
      coveringNamesByReg.set(i.subbingForRegistrationId, arr)
    }
    if (i.kind === 'roster' && i.registrationId) rosterNameByReg.set(i.registrationId, i.displayName)
  }

  const roster: AttendeeRow[] = []
  const subs: AttendeeRow[] = []
  for (const i of inputs) {
    const base: AttendeeRow = {
      id: i.id,
      displayName: i.displayName,
      kind: i.kind,
      status: i.status,
      teamName: i.teamName,
      selfReportBadge: i.selfReportBadge,
    }
    if (i.kind === 'roster') {
      const covering = i.registrationId ? coveringNamesByReg.get(i.registrationId) : undefined
      roster.push({ ...base, subbedByName: covering?.length ? covering.join('/') : undefined })
    } else {
      subs.push({ ...base, coveringName: i.subbingForRegistrationId ? rosterNameByReg.get(i.subbingForRegistrationId) : undefined })
    }
  }
  return { roster, subs }
}
