// Internal Glicko rating ⇄ public Joinzer Score (0–100). Absolute + monotonic, so a
// player's Score moves only when their skill does (never a live population percentile).
// score = 100 · logistic((rating − base)/scale), anchored so the default rating (1500,
// "average club player") → 50 — matching the LOCKED calibration in
// docs/phases/rating-engine-phase2.md §0 (10 true beginner · 30 rec · 50 avg club ·
// 70 strong · 90 elite). The exact per-activity fit is still a calibration TODO; this is
// the principled provisional mapping. Pure — no DB, not wired to anything yet.

import type { Activity } from './levels'

// Per-activity calibration (base rating → Score 50, `scale` = spread). Only pickleball
// for v1; the record shape is where future sports plug in their own calibration.
const CALIBRATION: Record<Activity, { base: number; scale: number }> = {
  pickleball: { base: 1500, scale: 173.7178 },
}

const cal = (activity: Activity) => CALIBRATION[activity] ?? CALIBRATION.pickleball

// Internal rating → 0–100 Joinzer Score.
export function scoreFromInternal(activity: Activity, rating: number): number {
  const { base, scale } = cal(activity)
  const mu = (rating - base) / scale
  const score = 100 / (1 + Math.exp(-mu))
  return Math.max(0, Math.min(100, Math.round(score)))
}

// 0–100 Score → internal rating (inverse). Used to seed a starting Glicko rating from a
// provisional self-reported Score. Clamped off the 0/100 asymptotes to avoid ±∞.
export function internalFromScore(activity: Activity, score: number): number {
  const { base, scale } = cal(activity)
  const s = Math.max(1, Math.min(99, score))
  const mu = Math.log(s / (100 - s))
  return base + scale * mu
}
