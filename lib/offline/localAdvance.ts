import { resolveBracket } from '../tournament/resolveCompletion'
import { applyMutations, type LocalMatch } from './applyMutations'

/**
 * Score a match locally and advance the bracket — the browser twin of the score route.
 * Records the result on the match, then runs the SHARED resolver (`resolveBracket`) and
 * applies its mutations (next-round fills, bye auto-advances, the double-elim reset), so
 * the local bracket progresses with no server. Because the server runs the same
 * deterministic engine on sync, local and server state converge.
 *
 * A tie is rejected (returns the input unchanged) — the caller validates scores first.
 */
export function scoreLocally(
  matches: LocalMatch[],
  matchId: string,
  team1Score: number,
  team2Score: number,
): LocalMatch[] {
  const target = matches.find(m => m.id === matchId)
  if (!target || team1Score === team2Score) return matches

  const winner = team1Score > team2Score
    ? target.team_1_registration_id
    : target.team_2_registration_id

  const scored: LocalMatch[] = matches.map(m =>
    m.id === matchId
      ? { ...m, team_1_score: team1Score, team_2_score: team2Score, winner_registration_id: winner, status: 'completed' }
      : m,
  )
  return applyMutations(scored, resolveBracket(scored))
}

/**
 * Settles generation-time byes (the WB byes a placeholder/elim bracket carries) without
 * scoring anything — run once after hydrating a fresh bracket so bye winners are advanced
 * before play, mirroring the generate route's applyByeAdvancements.
 */
export function settleByesLocally(matches: LocalMatch[]): LocalMatch[] {
  return applyMutations(matches, resolveBracket(matches))
}
