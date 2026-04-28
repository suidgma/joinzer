import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import LiveSessionManager from './LiveSessionManager'

export default async function LiveSessionPage({
  params,
}: {
  params: { id: string; sessionId: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: league }, { data: session }] = await Promise.all([
    supabase.from('leagues').select('id, name, created_by').eq('id', params.id).single(),
    supabase.from('league_sessions').select('id, session_number, session_date, status').eq('id', params.sessionId).single(),
  ])

  if (!league || !session) notFound()
  if (league.created_by !== user.id) redirect(`/compete/leagues/${params.id}`)

  // Fetch all registered players
  const { data: registrations } = await supabase
    .from('league_registrations')
    .select('user_id, profile:profiles(id, name, profile_photo_url, dupr_rating, estimated_rating, rating_source)')
    .eq('league_id', params.id)
    .eq('status', 'registered')

  // Fetch subs available for this session
  const { data: sessionSubs } = await supabase
    .from('league_session_subs')
    .select('user_id, profile:profiles(id, name, profile_photo_url)')
    .eq('session_id', params.sessionId)

  // Fetch current attendance
  const { data: attendance } = await supabase
    .from('league_session_attendance')
    .select('user_id, is_sub')
    .eq('session_id', params.sessionId)

  const players = (registrations ?? []).map((r) => {
    const p = r.profile as unknown as { id: string; name: string; profile_photo_url: string | null; dupr_rating: number | null; estimated_rating: number | null; rating_source: string | null }
    return { id: p.id, name: p.name, photoUrl: p.profile_photo_url, isSub: false }
  })

  const subs = (sessionSubs ?? []).map((s) => {
    const p = s.profile as unknown as { id: string; name: string; profile_photo_url: string | null }
    return { id: p.id, name: p.name, photoUrl: p.profile_photo_url, isSub: true }
  })

  const attendanceMap = new Map((attendance ?? []).map((a) => [a.user_id, a.is_sub]))
  const dateStr = new Date(session.session_date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href={`/compete/leagues/${params.id}/roster`} className="text-brand-muted text-sm">← Roster</Link>
      </div>

      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Live Session {session.session_number}</h1>
        <p className="text-sm text-brand-muted">{dateStr}</p>
      </div>

      <LiveSessionManager
        sessionId={params.sessionId}
        leagueId={params.id}
        players={players}
        subs={subs}
        initialAttendance={attendanceMap}
      />

      <div className="pt-2">
        <Link
          href={`/compete/leagues/${params.id}/sessions/${params.sessionId}/results`}
          className="block w-full text-center py-2.5 rounded-xl border border-brand-border text-sm font-medium text-brand-active hover:bg-brand-soft transition-colors"
        >
          Enter Match Results →
        </Link>
      </div>
    </main>
  )
}
