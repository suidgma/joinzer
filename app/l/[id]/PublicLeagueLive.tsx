'use client'

import { RealtimeProvider } from '@/lib/realtime/RealtimeProvider'
import RealtimeRefresh from '@/components/ui/RealtimeRefresh'
import { leagueFixturesTopic, RealtimeEvents } from '@/lib/realtime/topics'

// Makes the PUBLIC standings/results page live for spectators. The public page is outside
// the app layout, so it has no RealtimeProvider — this mounts a self-contained one plus a
// RealtimeRefresh on the league's fixtures topic. Broadcast channels are public, so anon
// viewers receive the same "fixtures changed" signal and the page refetches its standings.
export default function PublicLeagueLive({ leagueId }: { leagueId: string }) {
  return (
    <RealtimeProvider>
      <RealtimeRefresh topic={leagueFixturesTopic(leagueId)} events={[RealtimeEvents.leagueFixturesChanged]} />
    </RealtimeProvider>
  )
}
