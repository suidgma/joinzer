import { broadcast } from './serverBroadcast'
import { leagueFixturesTopic, RealtimeEvents } from './topics'

// Signal that a league's fixtures/results changed (a score entered/confirmed, a round
// finalized, fixtures generated, a cycle advanced). league_fixtures is deny-all, so this
// coarse per-league broadcast lets subscribed pages refetch their authorized server data
// (via RealtimeRefresh) rather than opening a client SELECT. Best-effort — call after the
// DB write succeeds; it never throws.
export function broadcastLeagueFixtures(leagueId: string): Promise<void> {
  return broadcast(leagueFixturesTopic(leagueId), RealtimeEvents.leagueFixturesChanged, {})
}
