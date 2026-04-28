import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import MatchEntryForm from './MatchEntryForm'

export default async function SessionResultsPage({
  params,
}: {
  params: { id: string; sessionId: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: league }, { data: session }, { data: matches }] = await Promise.all([
    supabase.from('leagues').select('id, name, created_by').eq('id', params.id).single(),
    supabase.from('league_sessions').select('id, session_number, session_date, status').eq('id', params.sessionId).single(),
    supabase
      .from('league_matches')
      .select('id, round_number, court_number, team1_score, team2_score, team1_player1:profiles!team1_player1_id(id,name), team1_player2:profiles!team1_player2_id(id,name), team2_player1:profiles!team2_player1_id(id,name), team2_player2:profiles!team2_player2_id(id,name)')
      .eq('session_id', params.sessionId)
      .order('round_number', { ascending: true }),
  ])

  if (!league || !session) notFound()
  if (league.created_by !== user.id) redirect(`/compete/leagues/${params.id}`)

  // Get registered players for the player select dropdowns
  const { data: registrations } = await supabase
    .from('league_registrations')
    .select('user_id, profile:profiles(id, name)')
    .eq('league_id', params.id)
    .eq('status', 'registered')

  const players = (registrations ?? []).map((r) => {
    const p = r.profile as unknown as { id: string; name: string }
    return { id: p.id, name: p.name }
  }).sort((a, b) => a.name.localeCompare(b.name))

  const dateStr = new Date(session.session_date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href={`/compete/leagues/${params.id}/roster`} className="text-brand-muted text-sm">← Roster</Link>
      </div>

      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Session {session.session_number} Results</h1>
        <p className="text-sm text-brand-muted">{dateStr}</p>
      </div>

      {/* Existing matches */}
      {matches && matches.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">Recorded Matches ({matches.length})</h2>
          <div className="space-y-2">
            {matches.map((m) => {
              const t1p1 = (m.team1_player1 as unknown as { id: string; name: string } | null)?.name ?? '?'
              const t1p2 = (m.team1_player2 as unknown as { id: string; name: string } | null)?.name ?? '?'
              const t2p1 = (m.team2_player1 as unknown as { id: string; name: string } | null)?.name ?? '?'
              const t2p2 = (m.team2_player2 as unknown as { id: string; name: string } | null)?.name ?? '?'
              const t1Won = (m.team1_score ?? 0) > (m.team2_score ?? 0)
              return (
                <div key={m.id} className="bg-brand-surface border border-brand-border rounded-xl p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className={`flex-1 ${t1Won ? 'font-semibold text-brand-dark' : 'text-brand-muted'}`}>
                      <p>{t1p1}</p>
                      <p>{t1p2}</p>
                    </div>
                    <div className="text-center px-2">
                      <p className="font-bold text-brand-dark">{m.team1_score ?? '—'} – {m.team2_score ?? '—'}</p>
                      {m.court_number && <p className="text-xs text-brand-muted">Court {m.court_number}</p>}
                    </div>
                    <div className={`flex-1 text-right ${!t1Won ? 'font-semibold text-brand-dark' : 'text-brand-muted'}`}>
                      <p>{t2p1}</p>
                      <p>{t2p2}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Add match form */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">Add Match</h2>
        <MatchEntryForm sessionId={params.sessionId} players={players} leagueId={params.id} />
      </section>
    </main>
  )
}
