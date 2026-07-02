// Shared score validation for match / fixture score entry. Used by the tournament
// score route today and (later) the league fixture score route, so both enforce
// the same rules: both scores numeric, non-negative, and no ties. Pure +
// dependency-free so it runs in route handlers and unit tests alike.
//
// Kept behavior-identical to the tournament score route's original inline checks
// (same messages, same order) — this is an extraction, not a rules change.
export type ScoreValidation = { ok: true } | { ok: false; error: string }

export function validateScores(team1: unknown, team2: unknown): ScoreValidation {
  if (typeof team1 !== 'number' || typeof team2 !== 'number') {
    return { ok: false, error: 'Scores must be numbers' }
  }
  if (team1 < 0 || team2 < 0) {
    return { ok: false, error: 'Scores cannot be negative' }
  }
  if (team1 === team2) {
    return { ok: false, error: 'Tie scores are not allowed' }
  }
  return { ok: true }
}
