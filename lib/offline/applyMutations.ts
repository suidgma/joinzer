import type { MatchRow } from '../tournament/bracketBuilder'
import type { Mutation } from '../tournament/resolveCompletion'

// A match as the offline engine works with it: the advancement fields (MatchRow) plus the
// scores the client enters. Scores don't affect advancement — resolveBracket ignores them —
// they ride along so the local working set stays complete for display + sync.
export type LocalMatch = MatchRow & {
  team_1_score?: number | null
  team_2_score?: number | null
}

/**
 * Applies resolveBracket()'s mutations to a matches ARRAY — the client-side twin of the
 * score route's apply-to-DB loop, with the same guards so it's replay/idempotent-safe:
 *   set      → fill an empty slot only (never overwrite a set team)
 *   complete → mark a bye winner (never re-complete)
 *   insert   → append the double-elim reset decider
 * Returns a new array; inputs are not mutated.
 */
export function applyMutations(matches: LocalMatch[], mutations: Mutation[]): LocalMatch[] {
  const result = matches.map(m => ({ ...m }))
  const byId = new Map(result.map(m => [m.id, m]))
  for (const mut of mutations) {
    if (mut.kind === 'set') {
      const m = byId.get(mut.matchId)
      if (m && m[mut.field] == null) m[mut.field] = mut.value
    } else if (mut.kind === 'complete') {
      const m = byId.get(mut.matchId)
      if (m && m.status !== 'completed') {
        m.status = 'completed'
        m.winner_registration_id = mut.winner
      }
    } else {
      const inserted: LocalMatch = { ...mut.match }
      result.push(inserted)
      byId.set(inserted.id, inserted)
    }
  }
  return result
}
