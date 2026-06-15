import {
  singleEliminationBracket,
  doubleEliminationBracket,
  poolPlayMatches,
  roundRobinMatches,
  rotatingDoublesMatches,
} from './bracketBuilder'
import { dedupeRegistrationsToTeams } from './teams'
import { isDoublesFormat } from '@/lib/taxonomy/formats'

// Builds bracket/match rows for one division from its settled registrations.
// Extracted so the per-division generate route and the block-based draft
// generator produce identical bracket structures. Mirrors the dedupe + seed +
// format dispatch of /divisions/[divisionId]/generate-matches.

export type BuildReg = {
  id: string
  user_id: string
  partner_registration_id: string | null
  seed?: number | null
}

export type BuildDivision = {
  format: string | null
  bracket_type: string
  format_settings_json: Record<string, unknown> | null
  partner_mode: string
}

export function buildDivisionMatchRows(
  division: BuildDivision,
  registrations: BuildReg[],
  base: Record<string, unknown>,
): { rows: object[] } | { error: string } {
  // One bracket slot per person — drop accidental duplicate registrations.
  const seen = new Set<string>()
  const deduped = registrations.filter(r => {
    if (seen.has(r.user_id)) return false
    seen.add(r.user_id)
    return true
  })

  // Honor explicit seeds when any are set; otherwise leave registration order.
  const hasSeeds = deduped.some(r => r.seed != null)
  if (hasSeeds) {
    deduped.sort((a, b) => {
      if (a.seed == null && b.seed == null) return 0
      if (a.seed == null) return 1
      if (b.seed == null) return -1
      return a.seed - b.seed
    })
  }

  const ft = division.bracket_type
  const fs = (division.format_settings_json ?? {}) as Record<string, unknown>
  const isRotating = division.partner_mode === 'rotating'

  if (isRotating && ft !== 'round_robin') {
    return { error: `rotating partner mode requires round_robin (uses ${ft})` }
  }

  if (isRotating) {
    const playerIds = deduped.map(r => r.id)
    if (playerIds.length < 4) return { error: `rotating doubles needs 4+ registrations (${playerIds.length})` }
    return { rows: rotatingDoublesMatches(playerIds, base).rows }
  }

  if (isDoublesFormat(division.format)) {
    const unpaired = deduped.filter(r => !r.partner_registration_id)
    if (unpaired.length > 0) {
      return { error: `${unpaired.length} player${unpaired.length === 1 ? '' : 's'} without a partner assigned` }
    }
  }

  const teams = dedupeRegistrationsToTeams(deduped)
  if (teams.length < 2) return { error: `fewer than 2 settled teams (${teams.length})` }

  if (ft === 'single_elimination') {
    return { rows: singleEliminationBracket(teams, 'single_elimination', base, 1, hasSeeds).rows }
  }
  if (ft === 'double_elimination') {
    return { rows: doubleEliminationBracket(teams, base, 1, hasSeeds) }
  }
  if (ft === 'pool_play_playoffs') {
    const numPools = (fs.number_of_pools as number) ?? 2
    return { rows: poolPlayMatches(teams, numPools, base).rows }
  }
  return { rows: roundRobinMatches(teams, base).rows }
}
