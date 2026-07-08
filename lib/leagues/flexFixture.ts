// Pure state machine for Flex League fixtures — the report → confirm → dispute → resolve
// loop that makes Flex player-driven. Extracted so it's unit-testable off the routes
// (mirrors Team League's teamMatchup.ts). No DB access: callers pass the fixture row + the
// user sets for each side, and get back the column patch to apply.
//
// Lifecycle (status values are all existing league_fixtures values — no migration):
//   scheduled ──report──▶ in_progress ("reported, awaiting confirm")
//   in_progress ──confirm──▶ completed
//   in_progress ──dispute──▶ disputed ──resolve(organizer)──▶ completed
// 'in_progress' is reused to mean "reported, awaiting confirmation".

import { validateScores } from '../scoring/validateScores'

export type Side = 'team_1' | 'team_2'

export type FlexFixtureState = {
  status: string
  team_1_registration_id: string | null
  team_2_registration_id: string | null
  reported_by: string | null
}

// The user_ids belonging to each side's entrant (singles: one; fixed-doubles: the pair).
export type EntrantSides = { team_1: Set<string>; team_2: Set<string> }

export type FlexPatch = {
  team_1_score?: number
  team_2_score?: number
  winner_registration_id?: string | null
  reported_by?: string | null
  confirmed_by?: string | null
  status?: string
}
export type FlexAction = { ok: true; patch: FlexPatch } | { ok: false; error: string; status?: number }

// Which side (if any) the acting user belongs to.
export function resolveActingSide(sides: EntrantSides, userId: string): Side | null {
  if (sides.team_1.has(userId)) return 'team_1'
  if (sides.team_2.has(userId)) return 'team_2'
  return null
}

const TERMINAL = new Set(['completed', 'forfeited', 'cancelled'])

// Winner registration = the canonical entrant reg on the winning side.
function winnerReg(fixture: FlexFixtureState, s1: number, s2: number): string | null {
  return s1 > s2 ? fixture.team_1_registration_id : fixture.team_2_registration_id
}

// ── report ──────────────────────────────────────────────────────────────────────
// Either entrant (or the organizer) enters the score → awaiting the opponent's confirm.
export function reportResult(
  fixture: FlexFixtureState,
  sides: EntrantSides,
  userId: string,
  isOrganizer: boolean,
  team1Score: unknown,
  team2Score: unknown,
): FlexAction {
  if (!fixture.team_1_registration_id || !fixture.team_2_registration_id) return { ok: false, error: 'Fixture has no opponent to play', status: 400 }
  if (TERMINAL.has(fixture.status)) return { ok: false, error: 'This match is already finalized', status: 409 }
  if (fixture.status === 'disputed') return { ok: false, error: 'This match is disputed — the organizer must resolve it', status: 409 }

  const side = resolveActingSide(sides, userId)
  if (!side && !isOrganizer) return { ok: false, error: "You're not a participant in this match", status: 403 }

  const check = validateScores(team1Score, team2Score)
  if (!check.ok) return { ok: false, error: check.error, status: 400 }
  const s1 = team1Score as number
  const s2 = team2Score as number

  return {
    ok: true,
    patch: {
      team_1_score: s1,
      team_2_score: s2,
      winner_registration_id: winnerReg(fixture, s1, s2),
      reported_by: userId,
      confirmed_by: null,
      status: 'in_progress',
    },
  }
}

// ── confirm ─────────────────────────────────────────────────────────────────────
// The OPPOSING entrant (or the organizer) accepts the reported score → completed.
export function confirmResult(fixture: FlexFixtureState, sides: EntrantSides, userId: string, isOrganizer: boolean): FlexAction {
  if (fixture.status !== 'in_progress') return { ok: false, error: 'There is no reported result to confirm', status: 409 }
  const side = resolveActingSide(sides, userId)
  const reporterSide = fixture.reported_by ? resolveActingSide(sides, fixture.reported_by) : null
  if (!isOrganizer) {
    if (!side) return { ok: false, error: "You're not a participant in this match", status: 403 }
    if (side === reporterSide) return { ok: false, error: 'You reported this result — your opponent must confirm it', status: 403 }
  }
  return { ok: true, patch: { confirmed_by: userId, status: 'completed' } }
}

// ── dispute ─────────────────────────────────────────────────────────────────────
// The opposing entrant flags the reported score → disputed (organizer resolves).
export function disputeResult(fixture: FlexFixtureState, sides: EntrantSides, userId: string, isOrganizer: boolean): FlexAction {
  if (fixture.status !== 'in_progress') return { ok: false, error: 'There is no reported result to dispute', status: 409 }
  const side = resolveActingSide(sides, userId)
  const reporterSide = fixture.reported_by ? resolveActingSide(sides, fixture.reported_by) : null
  if (!isOrganizer) {
    if (!side) return { ok: false, error: "You're not a participant in this match", status: 403 }
    if (side === reporterSide) return { ok: false, error: 'You reported this result — you cannot dispute your own report', status: 403 }
  }
  return { ok: true, patch: { status: 'disputed' } }
}

// ── resolve ─────────────────────────────────────────────────────────────────────
// Organizer only: set the final score and complete the match (clears a dispute).
export function resolveResult(fixture: FlexFixtureState, isOrganizer: boolean, team1Score: unknown, team2Score: unknown): FlexAction {
  if (!isOrganizer) return { ok: false, error: 'Only the organizer can resolve a match', status: 403 }
  if (TERMINAL.has(fixture.status)) return { ok: false, error: 'This match is already finalized', status: 409 }
  const check = validateScores(team1Score, team2Score)
  if (!check.ok) return { ok: false, error: check.error, status: 400 }
  const s1 = team1Score as number
  const s2 = team2Score as number
  return {
    ok: true,
    patch: {
      team_1_score: s1,
      team_2_score: s2,
      winner_registration_id: winnerReg(fixture, s1, s2),
      confirmed_by: null,
      status: 'completed',
    },
  }
}
