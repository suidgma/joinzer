'use client'

import { RealtimeProvider } from '@/lib/realtime/RealtimeProvider'
import RealtimeRefresh from '@/components/ui/RealtimeRefresh'

// Makes the PUBLIC tournament scoreboard live for spectators. The public page is outside the app
// layout, so it has no RealtimeProvider — this mounts a self-contained one plus a RealtimeRefresh
// on tournament_matches. That table is public-readable, so postgres_changes deliver to an anon
// socket and the page re-renders (force-dynamic) with fresh bracket state. Mirrors PublicLeagueLive,
// which uses a broadcast topic because league_fixtures is deny-all; here the table is public.
export default function PublicTournamentLive({ tournamentId }: { tournamentId: string }) {
  return (
    <RealtimeProvider>
      <RealtimeRefresh
        topic={`public-board-${tournamentId}`}
        postgresChanges={[{ event: '*', table: 'tournament_matches', filter: `tournament_id=eq.${tournamentId}` }]}
      />
    </RealtimeProvider>
  )
}
