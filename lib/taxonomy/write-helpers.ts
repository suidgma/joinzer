import { skillRangeToLevel } from './formats'

// Title Case keys — used by tournament divisions (matches Phase 1 migration Section 5)
const DIVISION_SKILL_TO_RANGE: Record<string, { skill_min: number; skill_max: number }> = {
  Beginner:     { skill_min: 2.0, skill_max: 2.5 },
  Intermediate: { skill_min: 3.0, skill_max: 3.5 },
  Advanced:     { skill_min: 4.0, skill_max: 4.5 },
}

// Combines the gender slice (category) and the format slice (team_type) into
// the single `format` value the rest of the app uses. The cleaned-up category
// vocabulary is ['men','women','mixed','coed','open']; team_type is
// ['singles','doubles']. See migration 20260528000001 for the DB shape.
function mapDivisionFormat(category: string, team_type: string): string {
  if (team_type === 'doubles') {
    if (category === 'men')   return 'mens_doubles'
    if (category === 'women') return 'womens_doubles'
    if (category === 'mixed') return 'mixed_doubles'
    if (category === 'coed')  return 'coed_doubles'
    if (category === 'open')  return 'open_doubles'
    return 'mixed_doubles' // safe doubles fallback
  }
  if (team_type === 'singles') {
    if (category === 'men')   return 'mens_singles'
    if (category === 'women') return 'womens_singles'
    // Mixed/coed don't have a singles concept; open_singles is the neutral choice.
    return 'open_singles'
  }
  return 'mixed_doubles' // very-defensive fallback for unrecognised team_type
}

export function prepareLeagueWrite(input: {
  format: string
  skill_min: number | null
  skill_max: number | null
}): {
  format: string
  skill_level: string | null
  skill_min: number | null
  skill_max: number | null
} {
  return {
    format: input.format,
    // still written until Phase 4 drops the legacy skill_level column
    skill_level: skillRangeToLevel(input.skill_min, input.skill_max),
    skill_min: input.skill_min,
    skill_max: input.skill_max,
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
