export const DOUBLES_FORMATS = [
  'mens_doubles',
  'womens_doubles',
  'mixed_doubles',
  'coed_doubles',
  'open_doubles',
] as const

export type DoublesFormat = (typeof DOUBLES_FORMATS)[number]

export function isDoublesFormat(format: string | null | undefined): boolean {
  return format != null && (DOUBLES_FORMATS as readonly string[]).includes(format)
}

export function formatSkillRange(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null
  if (min != null && max != null) return `${min.toFixed(1)} – ${max.toFixed(1)}`
  if (min != null) return `${min.toFixed(1)} and up`
  return `Up to ${max!.toFixed(1)}`
}

// Converts skill_min/max back to a skill_level key for sub request fields.
// Uses skill_min as the anchor; if null, returns null.
export function skillRangeToLevel(min: number | null, _max: number | null): string | null {
  if (min == null) return null
  if (min >= 4.0) return 'advanced'
  if (min >= 3.5) return 'intermediate_plus'
  if (min >= 3.0) return 'intermediate'
  if (min >= 2.5) return 'beginner_plus'
  return 'beginner'
}
