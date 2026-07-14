import { deriveHistory, type CompletedRound } from '../scheduling/leagueScheduler'

/**
 * True when every present player has faced every other present player as an
 * OPPONENT at least once — the natural "full round-robin" endpoint for a
 * rotating live session.
 *
 * Why opponents (not partners): a session round-robin is "done" once everyone
 * has played against everyone. Partnering is a fairness concern, not a
 * completion one, and in doubles you can't partner everyone anyway. In singles
 * every match is an opponent pairing, so this is exactly "all pairs have met."
 *
 * Byes don't create opponent links, so a player who only ever sat out won't
 * satisfy the check — which is correct: they haven't played everyone yet.
 *
 * Returns false for fewer than 2 present players (nothing to complete).
 */
export function everyoneHasFacedEveryone(
  presentPlayerIds: string[],
  completedRounds: CompletedRound[],
): boolean {
  const ids = [...new Set(presentPlayerIds)]
  if (ids.length < 2) return false

  const history = deriveHistory(completedRounds)
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const facedCount = history[ids[i]]?.opponents[ids[j]] ?? 0
      if (facedCount < 1) return false
    }
  }
  return true
}
