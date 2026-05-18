// Lowercase keys — used by leagues (matches Phase 1 migration Section 6)
const LEAGUE_SKILL_TO_RANGE: Record<string, { skill_min: number; skill_max: number }> = {
  beginner:          { skill_min: 2.0, skill_max: 2.5 },
  beginner_plus:     { skill_min: 2.5, skill_max: 3.0 },
  intermediate:      { skill_min: 3.0, skill_max: 3.5 },
  intermediate_plus: { skill_min: 3.5, skill_max: 4.0 },
  advanced:          { skill_min: 4.0, skill_max: 4.5 },
  advanced_plus:     { skill_min: 4.5, skill_max: 5.0 },
}

// Title Case keys — used by tournament divisions (matches Phase 1 migration Section 5)
const DIVISION_SKILL_TO_RANGE: Record<string, { skill_min: number; skill_max: number }> = {
  Beginner:     { skill_min: 2.0, skill_max: 2.5 },
  Intermediate: { skill_min: 3.0, skill_max: 3.5 },
  Advanced:     { skill_min: 4.0, skill_max: 4.5 },
}

// TypeScript port of Phase 1 migration Section 4 CASE block.
// Same 8 mapped pairs + generic fallback. Do not change without updating the migration comment.
function mapDivisionFormat(category: string, team_type: string): string {
  if (category === 'mens_doubles'   && team_type === 'doubles') return 'mens_doubles'
  if (category === 'womens_doubles' && team_type === 'doubles') return 'womens_doubles'
  if (category === 'mixed_doubles'  && team_type === 'doubles') return 'mixed_doubles'
  if (category === 'singles'        && team_type === 'singles') return 'mens_singles'
  if (category === 'open'           && team_type === 'singles') return 'open_singles'
  if (category === 'mens_doubles'   && team_type === 'singles') return 'mens_singles'
  if (category === 'womens_doubles' && team_type === 'singles') return 'womens_singles'
  if (category === 'mixed_doubles'  && team_type === 'singles') return 'open_singles'
  if (team_type === 'doubles') return 'mixed_doubles'
  if (team_type === 'singles') return 'open_singles'
  return 'mixed_doubles'
}

export function prepareLeagueWrite(input: {
  format: string
  skill_level: string
}): {
  format: string
  skill_level: string
  skill_min: number | null
  skill_max: number | null
} {
  const range = LEAGUE_SKILL_TO_RANGE[input.skill_level] ?? null
  return {
    format: input.format,
    skill_level: input.skill_level,
    skill_min: range?.skill_min ?? null,
    skill_max: range?.skill_max ?? null,
  }
}

export function prepareDivisionWrite(input: {
  category: string
  team_type: string
  skill_level: string | null
}): {
  category: string
  team_type: string
  skill_level: string | null
  format: string
  skill_min: number | null
  skill_max: number | null
} {
  const range = input.skill_level ? (DIVISION_SKILL_TO_RANGE[input.skill_level] ?? null) : null
  return {
    category: input.category,
    team_type: input.team_type,
    skill_level: input.skill_level,
    format: mapDivisionFormat(input.category, input.team_type),
    skill_min: range?.skill_min ?? null,
    skill_max: range?.skill_max ?? null,
  }
}

export function prepareEventWrite(input: {
  min_skill_level: number | null
  max_skill_level: number | null
}): {
  min_skill_level: number | null
  max_skill_level: number | null
  skill_min: number | null
  skill_max: number | null
} {
  return {
    min_skill_level: input.min_skill_level,
    max_skill_level: input.max_skill_level,
    skill_min: input.min_skill_level,
    skill_max: input.max_skill_level,
  }
}
