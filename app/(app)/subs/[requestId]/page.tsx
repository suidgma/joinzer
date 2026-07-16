import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadOpportunityById } from '@/lib/subs/loadOpportunities'
import SubDetailView from '@/components/features/subs/SubDetailView'
import RealtimeRefresh from '@/components/ui/RealtimeRefresh'
import { subRequestsTopic, RealtimeEvents } from '@/lib/realtime/topics'

export const dynamic = 'force-dynamic'

// Shared substitute-opportunity link. Under (app), so a logged-out visitor is redirected to
// /login?next=/subs/[id] by middleware and returns here after auth (open-redirect-safe). Eligibility
// is re-derived server-side for the current user; the shared link is never proof of eligibility.
export default async function SubDetailPage(props: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await props.params
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/subs/${requestId}`)}`)

  const detail = await loadOpportunityById(user.id, requestId)
  if (!detail) notFound()

  return (
    <div className="max-w-md mx-auto px-4 py-6 space-y-4 pb-24">
      <RealtimeRefresh topic={subRequestsTopic()} events={[RealtimeEvents.subRequestsChanged]} />
      <SubDetailView detail={detail} />
    </div>
  )
}
