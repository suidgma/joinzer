import {
  singleEliminationBracket,
  doubleEliminationBracket,
  playoffBracket,
} from './bracketBuilder'

// A playoff slot whose team isn't known yet: it points at a standings position.
// `label` is the human text shown in the bracket ("1st place", "Pool 1 - 2nd place").
// It's baked in at build time AND re-derivable from the structured fields via
// formatPlayoffLabel(), so the display can normalize older baked labels too.
export type PlayoffSource =
  | { kind: 'rank'; rank: number; label: string }
  | { kind: 'pool_rank'; pool: number; rank: number; label: string }

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

// The single source of truth for a placeholder slot's label — e.g. "1st place",
// "Pool 1 - 2nd place". Used both to bake the label at generation and to render it
// (deriving from kind/pool/rank), so all surfaces agree and older tournaments show
// the current wording. Falls back to any stored label if the fields are missing.
export function formatPlayoffLabel(source: {
  kind?: string | null
  pool?: number | null
  rank?: number | null
  label?: string | null
}): string {
  const { kind, pool, rank } = source
  if (kind === 'pool_rank' && pool != null && rank != null) return `Pool ${pool} - ${ordinal(rank)} place`
  if (kind === 'rank' && rank != null) return `${ordinal(rank)} place`
  return source.label ?? 'TBD'
}

// Round robin → top N finishers, in seed order (1st place, 2nd place, …).
export function roundRobinSources(qualifiers: number): PlayoffSource[] {
  return Array.from({ length: qualifiers }, (_, i) => {
    const rank = i + 1
    return { kind: 'rank', rank, label: formatPlayoffLabel({ kind: 'rank', rank }) }
  })
}

// Pool play → top `advancePerPool` from each pool, interleaved by rank across pools
// ([P1#1, P2#1, …, P1#2, P2#2, …]) — the seed order the bracket seeder expects so a
// pool winner meets another pool's runner-up and same-pool teams stay apart.
export function poolSources(numPools: number, advancePerPool: number): PlayoffSource[] {
  const out: PlayoffSource[] = []
  for (let rank = 1; rank <= advancePerPool; rank++) {
    for (let pool = 1; pool <= numPools; pool++) {
      out.push({ kind: 'pool_rank', pool, rank, label: formatPlayoffLabel({ kind: 'pool_rank', pool, rank }) })
    }
  }
  return out
}

export type PlaceholderEngine =
  | { engine: 'single' }                                                       // single elim
  | { engine: 'double' }                                                       // full double elim
  | { engine: 'rr_playoff'; finalFormat: 'single_elimination' | 'double_elimination' } // RR playoff (single elim + optional double final)

const TOKEN = (i: number) => `__pos${i}__`
const tokenIndex = (v: unknown): number =>
  typeof v === 'string' && v.startsWith('__pos') && v.endsWith('__') ? Number(v.slice(5, -2)) : -1

/**
 * Builds a playoff bracket whose first-round slots are POSITION PLACEHOLDERS (a
 * `team_*_source` instead of a team) so the bracket can be created and scheduled
 * before anyone's qualified. Reuses the real bracket builders with sentinel tokens,
 * then swaps the tokens for sources and un-completes the placeholder byes (the
 * builders auto-complete a bye, but a placeholder bye can't have a winner yet — it
 * resolves once its source is filled).
 */
export function buildPlaceholderPlayoffs(
  sources: PlayoffSource[],
  format: PlaceholderEngine,
  base: Record<string, unknown>,
  startMatchNum: number,
): Record<string, unknown>[] {
  if (sources.length < 2) return []
  const tokens = sources.map((_, i) => TOKEN(i))

  let rows: Record<string, unknown>[]
  if (format.engine === 'rr_playoff') {
    rows = playoffBracket(tokens, format.finalFormat, base, startMatchNum).rows as Record<string, unknown>[]
  } else if (format.engine === 'double') {
    rows = doubleEliminationBracket(tokens, base, startMatchNum, true) as Record<string, unknown>[]
  } else {
    rows = singleEliminationBracket(tokens, 'single_elimination', base, startMatchNum, true).rows as Record<string, unknown>[]
  }

  for (const row of rows) {
    const i1 = tokenIndex(row.team_1_registration_id)
    const i2 = tokenIndex(row.team_2_registration_id)
    if (i1 >= 0) { row.team_1_source = sources[i1]; row.team_1_registration_id = null }
    if (i2 >= 0) { row.team_2_source = sources[i2]; row.team_2_registration_id = null }
    // A placeholder bye was "completed" by the builder with a token winner — undo it.
    if (tokenIndex(row.winner_registration_id) >= 0) {
      row.status = 'scheduled'
      row.winner_registration_id = null
    }
  }
  return rows
}

// Builds the playoff placeholder rows for a "+ playoffs" division (round robin or
// pool play), to be inserted alongside the base matches so the bracket exists and is
// scheduled from the start. Returns [] for divisions without a playoff stage.
export function divisionPlayoffPlaceholders(
  bracketType: string,
  fs: Record<string, unknown>,
  teamCount: number,
  base: Record<string, unknown>,
  startMatchNum: number,
): Record<string, unknown>[] {
  if (bracketType === 'round_robin') {
    if (!fs.playoffs_enabled) return []
    const want = [2, 4, 6, 8].includes(fs.playoff_qualifiers as number) ? (fs.playoff_qualifiers as number) : 2
    const qualifiers = Math.min(want, teamCount)
    if (qualifiers < 2) return []
    const finalFormat = fs.playoff_format === 'double_elimination' ? 'double_elimination' : 'single_elimination'
    return buildPlaceholderPlayoffs(roundRobinSources(qualifiers), { engine: 'rr_playoff', finalFormat }, base, startMatchNum)
  }
  if (bracketType === 'pool_play_playoffs') {
    const numPools = (fs.number_of_pools as number) ?? 2
    const advancePerPool = [1, 2, 3, 4].includes(fs.teams_advance_per_pool as number) ? (fs.teams_advance_per_pool as number) : 2
    let sources = poolSources(numPools, advancePerPool)
    if (sources.length > teamCount) sources = sources.slice(0, teamCount) // guard a misconfigured (too-few-teams) division
    if (sources.length < 2) return []
    const engine = fs.playoff_format === 'double_elimination' ? ({ engine: 'double' } as const) : ({ engine: 'single' } as const)
    return buildPlaceholderPlayoffs(sources, engine, base, startMatchNum)
  }
  return []
}

// Resolves a placeholder source to the registration id that should fill it, given
// the final round-robin standings (overall) or per-pool standings. Returns null if
// the position doesn't exist (e.g. fewer teams than qualifiers).
export function resolvePlayoffSource(
  src: PlayoffSource,
  overallStandings: { regId: string }[],
  poolStandingsByPool: Map<number, { regId: string }[]>,
): string | null {
  if (src.kind === 'rank') return overallStandings[src.rank - 1]?.regId ?? null
  return poolStandingsByPool.get(src.pool)?.[src.rank - 1]?.regId ?? null
}
