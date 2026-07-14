import RealtimeRefresh from '@/components/ui/RealtimeRefresh'
import { leagueFixturesTopic, RealtimeEvents } from '@/lib/realtime/topics'

// Wraps every league sub-page (overview, standings/results, ladder, flex, roster, teams…)
// so one subscription keeps them all live: when any fixture/result changes anywhere in the
// league, RealtimeRefresh refetches the current page's server data. league_fixtures is
// deny-all, so this coarse broadcast-triggered refresh is how those surfaces go live.
export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <>
      <RealtimeRefresh topic={leagueFixturesTopic(id)} events={[RealtimeEvents.leagueFixturesChanged]} />
      {children}
    </>
  )
}
