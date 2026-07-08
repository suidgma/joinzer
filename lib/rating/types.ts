// Shared rating-engine types. A GameRecord is the normalized, source-agnostic outcome
// the engine consumes — one scored game (leagues + tournaments are all single-game).
// See docs/phases/rating-engine-phase2.md §2.

import type { Activity } from './levels'

export type RatingFormat = 'doubles' | 'singles' // mixed folds into doubles for v1

export type GameRecord = {
  id: string // source row id, prefixed by source (idempotency / debug)
  playedAt: string // ISO timestamp — chronological order + rating periods
  activity: Activity
  format: RatingFormat
  source: 'league' | 'tournament'
  competitionId: string // league_id / tournament_id
  occasionId: string // distinct session/cycle/tournament — powers the ≥3-events gate
  sideA: string[] // user_ids — 1 (singles) or 2 (doubles)
  sideB: string[]
  winner: 'A' | 'B'
}
