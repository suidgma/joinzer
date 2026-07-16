import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadOpenOpportunities, loadMyRequests, loadMySubstitutions } from '@/lib/subs/loadOpportunities'
import SubsBrowser from '@/components/features/subs/SubsBrowser'
import RealtimeRefresh from '@/components/ui/RealtimeRefresh'
import { subRequestsTopic, RealtimeEvents } from '@/lib/realtime/topics'

export const dynamic = 'force-dynamic'

// The dedicated substitute-browse destination. Available to every eligible player regardless of the
// open_to_subbing preference (that preference only gates proactive Home surfacing + notifications).
export default async function SubsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [openOpps, mySubs, myRequests] = await Promise.all([
    loadOpenOpportunities(user.id, { limit: 50 }),
    loadMySubstitutions(user.id),
    loadMyRequests(user.id),
  ])

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4 pb-24">
      <RealtimeRefresh topic={subRequestsTopic()} events={[RealtimeEvents.subRequestsChanged]} />
      <div>
        <h1 className="font-heading text-2xl font-bold text-brand-dark">Substitute openings</h1>
        <p className="text-sm text-brand-muted">Cover a session and help a league out — no organizer approval needed.</p>
      </div>
      <SubsBrowser openOpps={openOpps} mySubs={mySubs} myRequests={myRequests} />
    </div>
  )
}
