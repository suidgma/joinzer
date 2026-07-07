// Joinzer Level — the single, activity-aware mapping from the public 0–100 Joinzer
// Score to a human-readable level label. This is the ONE place labels are defined
// (avoid duplicate/hardcoded copies elsewhere). See docs/phases/rating-system.md.
//
// Config-first: label bands live here as versioned config. A future DB-backed
// `activity_rating_labels` table can replace the config behind `scoreToLevel` without
// touching callers. Pickleball is the first activity; the shape supports more.

export type Activity = 'pickleball'

export type LevelBand = { min: number; max: number; label: string }

const ACTIVITY_LEVELS: Record<Activity, LevelBand[]> = {
  pickleball: [
    { min: 0, max: 20, label: 'New Player' },
    { min: 21, max: 40, label: 'Beginner' },
    { min: 41, max: 60, label: 'Intermediate' },
    { min: 61, max: 80, label: 'Advanced' },
    { min: 81, max: 100, label: 'Elite' },
  ],
}

export function activityLevels(activity: Activity = 'pickleball'): LevelBand[] {
  return ACTIVITY_LEVELS[activity] ?? ACTIVITY_LEVELS.pickleball
}

// Public: universal 0–100 Joinzer Score → activity-specific Joinzer Level label.
export function scoreToLevel(activity: Activity, score: number): string {
  const bands = activityLevels(activity)
  const s = Math.max(0, Math.min(100, Math.round(score)))
  return bands.find((b) => s <= b.max)?.label ?? bands[bands.length - 1].label
}

// PROVISIONAL ONLY — this is NOT the rating engine. It seeds a 0–100 score from a
// self-reported DUPR-scale rating purely so we can show a human Joinzer Level today
// (Phase 0/1). Phase 2 replaces this with the calculated engine output. Anchors:
// 2.0 → 20, 3.5 → 55 (Intermediate), 5.0 → 90. Do NOT surface this number to players.
export function provisionalScoreFromSelfReport(rating: number | null | undefined): number | null {
  if (rating == null) return null
  const score = 20 + (rating - 2.0) * (70 / 3.0)
  return Math.max(0, Math.min(100, Math.round(score)))
}

// Convenience for Phase 0/1 display: self-reported rating → provisional Joinzer Level.
// No self-report → the entry-level label ("New Player").
export function selfReportedLevel(rating: number | null | undefined, activity: Activity = 'pickleball'): string {
  const score = provisionalScoreFromSelfReport(rating)
  if (score == null) return activityLevels(activity)[0].label
  return scoreToLevel(activity, score)
}
