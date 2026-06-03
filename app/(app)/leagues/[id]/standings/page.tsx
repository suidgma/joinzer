import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import StandingsTable from './StandingsTable'

export default async function LeagueStandingsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: league }, { data: registrations }, { data: sessions }] = await Promise.all([
    supabase.from('leagues').select('id, name, format, created_by, sub_credit_cap, standings_method').eq('id', params.id).single(),
    supabase
      .from('league_registrations')
      .select('user_id, profile:profiles!user_id(id, name, profile_photo_url)')
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
  const subCreditCap: number = (league as unknown as Record<string, unknown>)?.sub_credit_cap as number ?? 7
  const standingsMethod: 'win_loss' | 'total_points' = ((league as unknown as Record<string, unknown>)?.standings_method as string ?? 'win_loss') as 'win_loss' | 'total_points'

  // Map sessionId → chronological index for streak ordering
  const sessionOrder = new Map((sessions ?? []).map((s, i) => [s.id, i]))

  const [{ data: matches }, { data: subSessionPlayers }] = await Promise.all([
    sessionIds.length > 0
      ? supabase
          .from('league_matches')
          .select('session_id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, team1_score, team2_score')
          .in('session_id', sessionIds)
          .not('team1_score', 'is', null)
      : Promise.resolve({ data: [] }),
    sessionIds.length > 0
      ? supabase
          .from('league_session_players')
          .select('id, user_id, session_id, sub_for_session_player_id')
          .in('session_id', sessionIds)
          .not('sub_for_session_player_id', 'is', null)
      : Promise.resolve({ data: [] }),
  ])

  // Build sub redirect maps
  const absentSpIds = (subSessionPlayers ?? []).map(s => s.sub_for_session_player_id as string).filter(Boolean)
  const { data: absentSpRows } = absentSpIds.length > 0
    ? await supabase.from('league_session_players').select('id, user_id').in('id', absentSpIds)
    : { data: [] }
  const absentUserBySpId = new Map((absentSpRows ?? []).map(p => [p.id as string, p.user_id as string]))

  type SubInfo = { subToAbsent: Map<string, string>; absentUserIds: Set<string> }
  const subInfoBySession = new Map<string, SubInfo>()
  for (const sp of subSessionPlayers ?? []) {
    const sid = sp.session_id as string
    const subUid = sp.user_id as string
    const absentUid = absentUserBySpId.get(sp.sub_for_session_player_id as string)
    if (!subUid || !absentUid) continue
    if (!subInfoBySession.has(sid)) subInfoBySession.set(sid, { subToAbsent: new Map(), absentUserIds: new Set() })
    const info = subInfoBySession.get(sid)!
    info.subToAbsent.set(subUid, absentUid)
    info.absentUserIds.add(absentUid)
  }

  // Per-player stats
  type Stats = {
    points: number
    pointsAgainst: number
    games: number
    wins: number
    losses: number
    // chronological match results for streak: { sessionOrder, won }
    matchResults: { order: number; won: boolean }[]
  }
  const statsMap = new Map<string, Stats>()
  const sessionPts = new Map<string, Map<string, number>>()
  const sessionWL  = new Map<string, Map<string, { wins: number; losses: number }>>()

  for (const reg of registrations ?? []) {
    statsMap.set(reg.user_id, { points: 0, pointsAgainst: 0, games: 0, wins: 0, losses: 0, matchResults: [] })
  }

  for (const m of matches ?? []) {
    if (m.team1_score == null || m.team2_score == null) continue
    const team1Players = [m.team1_player1_id, m.team1_player2_id].filter(Boolean)
    const team2Players = [m.team2_player1_id, m.team2_player2_id].filter(Boolean)
    const info = subInfoBySession.get(m.session_id)
    const team1Won = m.team1_score > m.team2_score
    const order = sessionOrder.get(m.session_id) ?? 0

    const apply = (pid: string, pts: number, against: number, won: boolean) => {
      let effectivePid = pid
      let effectivePts = pts
      if (info) {
        const absentUid = info.subToAbsent.get(pid)
        if (absentUid) { effectivePid = absentUid; effectivePts = Math.min(pts, subCreditCap) }
        else if (info.absentUserIds.has(pid)) { effectivePts = Math.min(pts, subCreditCap) }
      }
      const s = statsMap.get(effectivePid) ?? { points: 0, pointsAgainst: 0, games: 0, wins: 0, losses: 0, matchResults: [] }
      s.games++
      s.points += effectivePts
      s.pointsAgainst += against
      if (won) s.wins++; else s.losses++
      s.matchResults.push({ order, won })
      statsMap.set(effectivePid, s)

      if (!sessionPts.has(effectivePid)) sessionPts.set(effectivePid, new Map())
      const bySession = sessionPts.get(effectivePid)!
      bySession.set(m.session_id, (bySession.get(m.session_id) ?? 0) + effectivePts)

      if (!sessionWL.has(effectivePid)) sessionWL.set(effectivePid, new Map())
      const byWL = sessionWL.get(effectivePid)!
      const cur = byWL.get(m.session_id) ?? { wins: 0, losses: 0 }
      byWL.set(m.session_id, { wins: cur.wins + (won ? 1 : 0), losses: cur.losses + (won ? 0 : 1) })
    }

    for (const pid of team1Players) { if (pid) apply(pid, m.team1_score, m.team2_score, team1Won) }
    for (const pid of team2Players) { if (pid) apply(pid, m.team2_score, m.team1_score, !team1Won) }
  }

  // Compute streak from chronological match results
  function computeStreak(results: { order: number; won: boolean }[]): { type: 'W' | 'L'; count: number } | null {
    if (results.length === 0) return null
    const sorted = [...results].sort((a, b) => a.order - b.order)
    const last = sorted[sorted.length - 1]
    let count = 0
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].won === last.won) count++
      else break
    }
    return { type: last.won ? 'W' : 'L', count }
  }

  const standings = (registrations ?? []).map((r) => {
    const p = r.profile as unknown as { id: string; name: string; profile_photo_url: string | null }
    const s = statsMap.get(r.user_id) ?? { points: 0, pointsAgainst: 0, games: 0, wins: 0, losses: 0, matchResults: [] }
    const streak = computeStreak(s.matchResults)
    const winPct = s.games > 0 ? s.wins / s.games : 0
    return { ...p, userId: r.user_id, ...s, streak, winPct, diff: s.points - s.pointsAgainst }
  }).sort((a, b) =>
    standingsMethod === 'total_points'
      ? b.points - a.points || b.diff - a.diff || b.winPct - a.winPct
      : b.winPct - a.winPct || b.diff - a.diff || b.points - a.points
  )

  const hasResults = !!matches && matches.length > 0
  const isManager = user?.id === league.created_by
  const firstSession = sessions?.[0]
  const registeredCount = (registrations ?? []).length
  const sessionList = sessions ?? []

  const sessionsWithData = sessionList.filter(s =>
    (matches ?? []).some(m => m.session_id === s.id)
  )

  const navItems: ManageNavItem[] = [
    { label: 'Overview', href: `/leagues/${params.id}` },
    { label: 'Standings', href: `/leagues/${params.id}/standings` },
    ...(isManager ? [
      { label: 'Roster', href: `/leagues/${params.id}/roster` },
      { label: 'Edit', href: `/leagues/${params.id}/edit` },
    ] : []),
  ]

  return (
    <DesktopShell
      header={
        <div className="flex items-center gap-3">
          <Link href={`/leagues/${params.id}`} className="text-brand-muted text-sm">← {league.name}</Link>
          <span className="text-brand-muted text-sm">/</span>
          <span className="text-sm font-medium text-brand-dark">Standings</span>
        </div>
      }
      sidebar={<ManageNav items={navItems} />}
    >
      <ManageNav items={navItems} mobileOnly />
      <div className="space-y-6 pb-8">

      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Standings</h1>
        <p className="text-xs text-brand-muted">
          Sorted by points scored by default. Click any column header to re-sort.
        </p>
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
              href={`/leagues/${params.id}/sessions/${firstSession.id}/results`}
              className="inline-block mt-2 text-xs text-brand-active font-medium underline underline-offset-2"
            >
              Enter results for play 1 →
            </Link>
          )}
        </div>
      ) : (
        <StandingsTable
          initialStandings={standings}
          sessionsWithData={sessionsWithData}
          sessionPts={Object.fromEntries(
            Array.from(sessionPts.entries()).map(([uid, bySession]) => [uid, Object.fromEntries(bySession.entries())])
          )}
          sessionWL={Object.fromEntries(
            Array.from(sessionWL.entries()).map(([uid, bySession]) => [uid, Object.fromEntries(bySession.entries())])
          )}
          standingsMethod={standingsMethod}
        />
      )}
      </div>
    </DesktopShell>
  )
}
