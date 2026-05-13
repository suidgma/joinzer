import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { formatSessionDate } from '@/lib/utils/date'
import MatchEntryForm from './MatchEntryForm'
import LockedRoundsScoring, { type LockedMatch } from './LockedRoundsScoring'

export const dynamic = 'force-dynamic'

export default async function SessionResultsPage(
  props: {
    params: Promise<{ id: string; sessionId: string }>
  }
) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: league }, { data: session }] = await Promise.all([
    supabase.from('leagues').select('id, name, created_by, points_to_win').eq('id', params.id).single(),
    supabase.from('league_sessions').select('id, session_number, session_date, status, rounds_planned').eq('id', params.sessionId).single(),
  ])

  if (!league || !session) notFound()
  if (league.created_by !== user.id) redirect(`/compete/leagues/${params.id}`)

  // Fetch all data in parallel
  const [
    { data: existingMatches },
    { data: registrations },
    { data: lockedRounds },
    { data: sessionPlayers },
  ] = await Promise.all([
    supabase
      .from('league_matches')
      .select('id, round_number, court_number, team1_score, team2_score, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, team1_player1:profiles!team1_player1_id(id,name), team1_player2:profiles!team1_player2_id(id,name), team2_player1:profiles!team2_player1_id(id,name), team2_player2:profiles!team2_player2_id(id,name)')
      .eq('session_id', params.sessionId)
      .order('round_number', { ascending: true }),
    supabase
      .from('league_registrations')
      .select('user_id, profile:profiles(id, name)')
      .eq('league_id', params.id)
      .eq('status', 'registered'),
    supabase
      .from('league_rounds')
      .select('id, round_number, status, matches:league_round_matches(*)')
      .eq('session_id', params.sessionId)
      .in('status', ['locked', 'completed'])
      .order('round_number', { ascending: true }),
    supabase
      .from('league_session_players')
      .select('id, user_id, display_name, sub_for_session_player_id')
      .eq('session_id', params.sessionId),
  ])

  // Map session_player_id → { userId, name }
  // Subs are redirected to the absent player's userId so match credits go to them.
  const spMap = new Map<string, { userId: string; name: string }>()
  // First pass: non-subs
  for (const sp of sessionPlayers ?? []) {
    if (sp.user_id && !sp.sub_for_session_player_id) {
      spMap.set(sp.id, { userId: sp.user_id, name: sp.display_name })
    }
  }
  // Second pass: subs → credit goes to absent player's userId, but display the sub's name
  for (const sp of sessionPlayers ?? []) {
    if (sp.sub_for_session_player_id) {
      const absentEntry = spMap.get(sp.sub_for_session_player_id as string)
      if (absentEntry) spMap.set(sp.id, { userId: absentEntry.userId, name: sp.display_name })
    }
  }

  // Build a set of existing match signatures to detect already-saved scores
  // Signature: round_number + sorted player IDs — prevents same players in different rounds cross-matching
  function matchSig(roundNumber: number, ids: (string | null)[]): string {
    return `${roundNumber}:${ids.filter(Boolean).sort().join(',')}`
  }
  type MatchScore = { team1Score: number; team2Score: number }
  const savedMatchSigs = new Map<string, MatchScore>()
  for (const m of existingMatches ?? []) {
    if (m.team1_score == null || m.team2_score == null) continue
    const sig = matchSig(m.round_number, [m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id])
    savedMatchSigs.set(sig, { team1Score: m.team1_score, team2Score: m.team2_score })
  }

  // Build LockedMatch list from locked rounds
  const lockedMatches: LockedMatch[] = []
  for (const round of lockedRounds ?? []) {
    const roundMatches = (round.matches as Record<string, unknown>[]) ?? []
    for (const rm of roundMatches) {
      if (rm.match_type === 'bye') continue

      const resolve = (id: unknown) => id ? spMap.get(id as string) ?? null : null

      if (rm.match_type === 'doubles') {
        const t1p1 = resolve(rm.team1_player1_id)
        const t1p2 = resolve(rm.team1_player2_id)
        const t2p1 = resolve(rm.team2_player1_id)
        const t2p2 = resolve(rm.team2_player2_id)
        const team1 = [t1p1, t1p2].filter(Boolean) as { userId: string; name: string }[]
        const team2 = [t2p1, t2p2].filter(Boolean) as { userId: string; name: string }[]
        if (team1.length === 0 || team2.length === 0) continue
        const sig = matchSig(round.round_number, [...team1.map(p => p.userId), ...team2.map(p => p.userId)])
        lockedMatches.push({
          roundMatchId: rm.id as string,
          roundNumber: round.round_number,
          courtNumber: (rm.court_number as number | null) ?? null,
          matchType: 'doubles',
          team1,
          team2,
          existingScore: savedMatchSigs.get(sig) ?? null,
        })
      } else if (rm.match_type === 'singles') {
        const p1 = resolve(rm.singles_player1_id)
        const p2 = resolve(rm.singles_player2_id)
        if (!p1 || !p2) continue
        const sig = matchSig(round.round_number, [p1.userId, p2.userId])
        lockedMatches.push({
          roundMatchId: rm.id as string,
          roundNumber: round.round_number,
          courtNumber: (rm.court_number as number | null) ?? null,
          matchType: 'singles',
          team1: [p1],
          team2: [p2],
          existingScore: savedMatchSigs.get(sig) ?? null,
        })
      }
    }
  }

  const players = (registrations ?? []).map((r) => {
    const p = r.profile as unknown as { id: string; name: string }
    return { id: p.id, name: p.name }
  }).sort((a, b) => a.name.localeCompare(b.name))

  const dateStr = formatSessionDate(session.session_date, { weekday: 'long', month: 'long', day: 'numeric' })

  // Manually-entered matches (those not from locked rounds)
  const lockedPlayerSigs = new Set(
    lockedMatches.map((m) => matchSig(m.roundNumber, [...m.team1.map(p => p.userId), ...m.team2.map(p => p.userId)]))
  )
  const manualMatches = (existingMatches ?? []).filter((m) => {
    const sig = matchSig(m.round_number, [m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id])
    return !lockedPlayerSigs.has(sig)
  })

  return (
    <main className="max-w-lg mx-auto p-4 space-y-6">
      <div className="flex items-center gap-2">
        <Link href={`/compete/leagues/${params.id}/sessions/${params.sessionId}/live`} className="text-brand-muted text-sm">← Back</Link>
      </div>

      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Session {session.session_number} Results</h1>
        <p className="text-sm text-brand-muted">{dateStr}</p>
      </div>

      {/* Auto-populated from locked rounds */}
      <LockedRoundsScoring sessionId={params.sessionId} leagueId={params.id} matches={lockedMatches} roundsPlanned={session.rounds_planned ?? 7} pointsToWin={league.points_to_win ?? 11} />

      {/* Manually entered matches (not from locked rounds) */}
      {manualMatches.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">Other Matches ({manualMatches.length})</h2>
          <div className="space-y-2">
            {manualMatches.map((m) => {
              const t1p1 = (m.team1_player1 as unknown as { name: string } | null)?.name ?? '?'
              const t1p2 = (m.team1_player2 as unknown as { name: string } | null)?.name ?? '?'
              const t2p1 = (m.team2_player1 as unknown as { name: string } | null)?.name ?? '?'
              const t2p2 = (m.team2_player2 as unknown as { name: string } | null)?.name ?? '?'
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

      {/* Manual add form */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-brand-dark uppercase tracking-wide">Add Match Manually</h2>
        <MatchEntryForm sessionId={params.sessionId} players={players} leagueId={params.id} pointsToWin={league.points_to_win ?? 11} />
      </section>
    </main>
  )
}
