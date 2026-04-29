import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'

export default async function LeagueStandingsPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: league }, { data: registrations }, { data: sessions }] = await Promise.all([
    supabase.from('leagues').select('id, name, format, created_by').eq('id', params.id).single(),
    supabase
      .from('league_registrations')
      .select('user_id, profile:profiles(id, name, profile_photo_url)')
      .eq('league_id', params.id)
      .eq('status', 'registered'),
    supabase
      .from('league_sessions')
      .select('id, session_number, session_date')
      .eq('league_id', params.id)
      .order('session_date', { ascending: true }),
  ])

  if (!league) notFound()

  const sessionIds = (sessions ?? []).map((s) => s.id)

  const { data: matches } = sessionIds.length > 0
    ? await supabase
        .from('league_matches')
        .select('session_id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, team1_score, team2_score')
        .in('session_id', sessionIds)
        .not('team1_score', 'is', null)
    : { data: [] }

  // Build overall stats + per-session points
  type Stats = { points: number; games: number }
  const statsMap   = new Map<string, Stats>()
  const sessionPts = new Map<string, Map<string, number>>() // playerId → sessionId → pts

  for (const reg of registrations ?? []) {
    statsMap.set(reg.user_id, { points: 0, games: 0 })
  }

  for (const m of matches ?? []) {
    if (m.team1_score == null || m.team2_score == null) continue
    const team1Players = [m.team1_player1_id, m.team1_player2_id].filter(Boolean)
    const team2Players = [m.team2_player1_id, m.team2_player2_id].filter(Boolean)

    const apply = (pid: string, pts: number) => {
      const s = statsMap.get(pid) ?? { points: 0, games: 0 }
      s.games++; s.points += pts
      statsMap.set(pid, s)
      if (!sessionPts.has(pid)) sessionPts.set(pid, new Map())
      const bySession = sessionPts.get(pid)!
      bySession.set(m.session_id, (bySession.get(m.session_id) ?? 0) + pts)
    }

    for (const pid of team1Players) { if (pid) apply(pid, m.team1_score) }
    for (const pid of team2Players) { if (pid) apply(pid, m.team2_score) }
  }

  const standings = (registrations ?? []).map((r) => {
    const p = r.profile as unknown as { id: string; name: string; profile_photo_url: string | null }
    const s = statsMap.get(r.user_id) ?? { points: 0, games: 0 }
    return { ...p, userId: r.user_id, ...s }
  }).sort((a, b) => b.points - a.points || b.games - a.games)

  const hasResults      = !!matches && matches.length > 0
  const isManager       = user?.id === league.created_by
  const firstSession    = sessions?.[0]
  const registeredCount = (registrations ?? []).length
  const sessionList     = sessions ?? []

  // Sessions that have at least one match result
  const sessionsWithData = sessionList.filter(s =>
    (matches ?? []).some(m => m.session_id === s.id)
  )

  return (
    <main className="max-w-2xl mx-auto p-4 space-y-6">
      <div className="flex items-center gap-2">
        <Link href={`/compete/leagues/${params.id}`} className="text-brand-muted text-sm">← {league.name}</Link>
      </div>

      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Standings</h1>
        <p className="text-xs text-brand-muted">Ranked by total points scored</p>
      </div>

      {!hasResults ? (
        <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
          <p className="text-2xl">🏓</p>
          <p className="text-sm font-medium text-brand-dark">No results yet</p>
          <p className="text-xs text-brand-muted">
            {registeredCount > 0
              ? `${registeredCount} player${registeredCount !== 1 ? 's' : ''} registered. Standings will appear once match results are entered.`
              : 'Standings will appear once players register and match results are entered.'}
          </p>
          {isManager && firstSession && (
            <Link
              href={`/compete/leagues/${params.id}/sessions/${firstSession.id}/results`}
              className="inline-block mt-2 text-xs text-brand-active font-medium underline underline-offset-2"
            >
              Enter results for session 1 →
            </Link>
          )}
        </div>
      ) : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="min-w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-brand-soft text-left px-3 py-2 text-xs font-semibold text-brand-muted uppercase tracking-wide border-b border-r border-brand-border whitespace-nowrap z-10">
                    Player
                  </th>
                  <th className="px-3 py-2 text-center text-xs font-bold text-brand-dark uppercase tracking-wide border-b border-brand-border whitespace-nowrap bg-brand-soft">PTS</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-brand-muted uppercase tracking-wide border-b border-brand-border whitespace-nowrap bg-brand-soft">GP</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-brand-muted uppercase tracking-wide border-b border-brand-border whitespace-nowrap bg-brand-soft">AVG</th>
                  {sessionsWithData.map((s) => (
                    <th key={s.id} className="px-3 py-2 text-center text-xs font-semibold text-brand-muted uppercase tracking-wide border-b border-l border-brand-border whitespace-nowrap bg-brand-soft">
                      Wk {s.session_number}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {standings.map((p, i) => {
                  const bySession = sessionPts.get(p.userId) ?? new Map()
                  const rowBg = i % 2 === 0 ? 'bg-white' : 'bg-brand-surface'
                  return (
                    <tr key={p.id}>
                      <td className={`sticky left-0 px-3 py-2.5 border-r border-b border-brand-border whitespace-nowrap z-10 ${rowBg}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-brand-muted text-xs w-4 text-right flex-shrink-0">{i + 1}</span>
                          <div className="w-6 h-6 rounded-full overflow-hidden bg-brand-soft border border-brand-border flex-shrink-0">
                            {p.profile_photo_url
                              ? <img src={p.profile_photo_url} alt={p.name} className="w-full h-full object-cover" />
                              : <span className="flex items-center justify-center w-full h-full text-brand-muted text-[10px]">{p.name[0]}</span>
                            }
                          </div>
                          <span className="text-sm font-medium text-brand-dark">{p.name}</span>
                        </div>
                      </td>
                      <td className={`px-3 py-2.5 text-center border-b border-brand-border ${rowBg}`}>
                        <span className="text-sm font-bold text-brand-dark">{p.points}</span>
                      </td>
                      <td className={`px-3 py-2.5 text-center border-b border-brand-border ${rowBg}`}>
                        <span className="text-sm text-brand-muted">{p.games}</span>
                      </td>
                      <td className={`px-3 py-2.5 text-center border-b border-brand-border ${rowBg}`}>
                        <span className="text-xs text-brand-muted">
                          {p.games > 0 ? (p.points / p.games).toFixed(1) : '—'}
                        </span>
                      </td>
                      {sessionsWithData.map((s) => {
                        const val = bySession.get(s.id)
                        return (
                          <td key={s.id} className={`px-3 py-2.5 text-center border-b border-l border-brand-border ${rowBg}`}>
                            {val != null
                              ? <span className="text-sm text-brand-dark">{val}</span>
                              : <span className="text-xs text-brand-muted">—</span>
                            }
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
      )}
    </main>
  )
}
