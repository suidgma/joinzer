import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'

type PlayerRow = {
  id: string
  name: string
  profile_photo_url: string | null
  wins: number
  losses: number
  gamesPlayed: number
  winPct: number
}

export default async function LeagueStandingsPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: league }, { data: registrations }, { data: sessions }] = await Promise.all([
    supabase.from('leagues').select('id, name, created_by').eq('id', params.id).single(),
    supabase
      .from('league_registrations')
      .select('user_id, profile:profiles(id, name, profile_photo_url)')
      .eq('league_id', params.id)
      .eq('status', 'registered'),
    supabase
      .from('league_sessions')
      .select('id, session_date')
      .eq('league_id', params.id)
      .order('session_date', { ascending: true }),
  ])

  if (!league) notFound()

  const sessionIds = (sessions ?? []).map((s) => s.id)

  const { data: matches } = sessionIds.length > 0
    ? await supabase
        .from('league_matches')
        .select('team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, team1_score, team2_score')
        .in('session_id', sessionIds)
        .not('team1_score', 'is', null)
    : { data: [] }

  // Build standings from match data
  const statsMap = new Map<string, { wins: number; losses: number }>()

  for (const reg of registrations ?? []) {
    statsMap.set(reg.user_id, { wins: 0, losses: 0 })
  }

  for (const m of matches ?? []) {
    if (m.team1_score == null || m.team2_score == null) continue
    const team1Won = m.team1_score > m.team2_score
    const team1Players = [m.team1_player1_id, m.team1_player2_id].filter(Boolean)
    const team2Players = [m.team2_player1_id, m.team2_player2_id].filter(Boolean)

    for (const pid of team1Players) {
      if (!pid) continue
      const s = statsMap.get(pid) ?? { wins: 0, losses: 0 }
      team1Won ? s.wins++ : s.losses++
      statsMap.set(pid, s)
    }
    for (const pid of team2Players) {
      if (!pid) continue
      const s = statsMap.get(pid) ?? { wins: 0, losses: 0 }
      team1Won ? s.losses++ : s.wins++
      statsMap.set(pid, s)
    }
  }

  const standings: PlayerRow[] = (registrations ?? []).map((r) => {
    const p = r.profile as unknown as { id: string; name: string; profile_photo_url: string | null }
    const s = statsMap.get(r.user_id) ?? { wins: 0, losses: 0 }
    const gamesPlayed = s.wins + s.losses
    return {
      id: p.id,
      name: p.name,
      profile_photo_url: p.profile_photo_url,
      wins: s.wins,
      losses: s.losses,
      gamesPlayed,
      winPct: gamesPlayed > 0 ? s.wins / gamesPlayed : 0,
    }
  }).sort((a, b) => b.wins - a.wins || a.losses - b.losses)

  const hasResults = matches && matches.length > 0
  const isManager = user?.id === league.created_by
  const firstSession = sessions?.[0]
  const registeredCount = (registrations ?? []).length

  return (
    <main className="max-w-lg mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href={`/compete/leagues/${params.id}`} className="text-brand-muted text-sm">← {league.name}</Link>
      </div>

      <h1 className="font-heading text-xl font-bold text-brand-dark">Standings</h1>

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
        <div className="bg-brand-surface border border-brand-border rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-3 px-4 py-2 bg-brand-soft border-b border-brand-border text-xs font-semibold text-brand-muted uppercase tracking-wide">
            <span>#</span>
            <span>Player</span>
            <span className="text-right">W</span>
            <span className="text-right">L</span>
            <span className="text-right">Win%</span>
          </div>
          {standings.map((p, i) => (
            <div key={p.id} className={`grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-3 items-center px-4 py-3 ${i < standings.length - 1 ? 'border-b border-brand-border' : ''}`}>
              <span className="text-sm text-brand-muted w-5 text-right">{i + 1}</span>
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full overflow-hidden bg-brand-soft border border-brand-border flex-shrink-0">
                  {p.profile_photo_url
                    ? <img src={p.profile_photo_url} alt={p.name} className="w-full h-full object-cover" />
                    : <span className="flex items-center justify-center w-full h-full text-brand-muted text-xs">{p.name[0]}</span>
                  }
                </div>
                <span className="text-sm font-medium text-brand-dark truncate">{p.name}</span>
              </div>
              <span className="text-sm font-semibold text-brand-dark text-right">{p.wins}</span>
              <span className="text-sm text-brand-muted text-right">{p.losses}</span>
              <span className="text-xs text-brand-muted text-right">
                {p.gamesPlayed > 0 ? `${Math.round(p.winPct * 100)}%` : '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
