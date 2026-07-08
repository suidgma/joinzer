// The single decision for how a player's rating identity is shown: a calculated Joinzer
// Score once it's EARNED (Established or Rusty), otherwise the honest self-reported Level
// (Phase 1 behavior). Reads the profiles cache — no player_ratings access needed.
// See docs/phases/rating-system.md + rating-engine-phase2.md.

import { selfReportedLevel } from './levels'

export type RatingDisplay =
  | { kind: 'earned'; level: string; score: number; state: 'established' | 'rusty'; games: number | null }
  | { kind: 'selfReported'; level: string; selfRating: number | null; selfScale: string | null }

export function ratingDisplay(p: {
  primary_joinzer_score?: number | null
  primary_joinzer_level?: string | null
  primary_confidence?: string | null
  primary_games?: number | null
  self_reported_rating?: number | null
  self_reported_scale?: string | null
}): RatingDisplay {
  const earned =
    (p.primary_confidence === 'established' || p.primary_confidence === 'rusty') &&
    p.primary_joinzer_score != null &&
    p.primary_joinzer_level != null
  if (earned) {
    return {
      kind: 'earned',
      level: p.primary_joinzer_level!,
      score: p.primary_joinzer_score!,
      state: p.primary_confidence as 'established' | 'rusty',
      games: p.primary_games ?? null,
    }
  }
  return {
    kind: 'selfReported',
    level: selfReportedLevel(p.self_reported_rating),
    selfRating: p.self_reported_rating ?? null,
    selfScale: p.self_reported_scale ?? null,
  }
}
