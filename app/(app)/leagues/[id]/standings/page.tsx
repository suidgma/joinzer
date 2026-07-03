import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import type { ManageNavItem } from '@/components/ui/manage-nav'
import StandingsTable from './StandingsTable'
import BoxStandings, { type BoxStandingView } from './BoxStandings'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import { computeFixtureStandings } from '@/lib/leagues/fixtureStandings'

export default async function LeagueStandingsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: league }, { data: registrations }, { data: sessions }] = await Promise.all([
    supabase.from('leagues').select('id, name, format, created_by, sub_credit_cap, standings_method, partner_mode, format_kind').eq('id', params.id).single(),
    supabase
      .from('league_registrations')
      .select('user_id, partner_user_id, profile:profiles!user_id(id, name, profile_photo_url)')
      .eq('league_id', params.id)
      .eq('status', 'registered'),
    supabase
      .from('league_sessions')
      .select('id, session_number, session_date')
      .eq('league_id', params.id)
      .order('session_date', { ascending: true }),
  ])

  if (!league) notFound()

  const isManager0 = user?.id === league.created_by

  // ── Box leagues: per-box standings from fixtures. Early return keeps the
  //    session_rr path below completely untouched. ──
  if ((league as any).format_kind === 'box') {
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const doubles = isDoublesFormat((league as any).format)
    const firstName = (n?: string | null) => (n ? n.trim().split(/\s+/)[0] : '')

    const { data: regsRaw } = await admin
      .from('league_registrations')
      .select('id, user_id, status, payment_status, partner_registration_id, profile:profiles!user_id(name)')
      .eq('league_id', params.id).eq('status', 'registered')
    const settled = (regsRaw ?? []).filter((r: any) => r.payment_status == null || ['paid', 'waived', 'comped', 'free'].includes(r.payment_status))
    const byRegId = new Map(settled.map((r: any) => [r.id, r]))
    const nameOf = (regId: string): string => {
      const r: any = byRegId.get(regId)
      if (!r) return 'Player'
      const a = firstName(r.profile?.name)
      if (!doubles) return a || 'Player'
      const partner: any = r.partner_registration_id ? byRegId.get(r.partner_registration_id) : null
      const b = partner ? firstName(partner.profile?.name) : ''
      return b ? `${a}/${b}` : (a || 'Team')
    }

    const { data: cyc } = await admin
      .from('league_periods').select('id')
      .eq('league_id', params.id).eq('period_kind', 'cycle').eq('status', 'active')
      .order('period_number', { ascending: false }).limit(1).maybeSingle()

    let boxViews: BoxStandingView[] = []
    if (cyc) {
      const { data: bx } = await admin.from('league_boxes').select('id, tier_rank, name').eq('period_id', cyc.id).order('tier_rank', { ascending: true })
      const bxIds = (bx ?? []).map((b: any) => b.id)
      const { data: mem } = bxIds.length
        ? await admin.from('league_box_members').select('box_id, registration_id').in('box_id', bxIds)
        : { data: [] as any[] }
      const memberIdsByBox = new Map<string, string[]>()
      for (const m of (mem ?? [])) {
        if (!memberIdsByBox.has(m.box_id)) memberIdsByBox.set(m.box_id, [])
        memberIdsByBox.get(m.box_id)!.push(m.registration_id)
      }
      const { data: fx } = bxIds.length
        ? await admin.from('league_fixtures')
            .select('match_stage, round_number, status, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, winner_registration_id, box_id, period_id')
            .eq('period_id', cyc.id)
        : { data: [] as any[] }

      boxViews = (bx ?? []).map((b: any) => {
        const memberIds = new Set(memberIdsByBox.get(b.id) ?? [])
        const regsForBox = settled
          .filter((r: any) => memberIds.has(r.id))
          .map((r: any) => ({ id: r.id, status: r.status, partner_registration_id: r.partner_registration_id }))
        const rows = computeFixtureStandings((fx ?? []) as any, regsForBox, { boxId: b.id }, nameOf)
        return {
          name: b.name ?? `Box ${b.tier_rank}`,
          rows: rows.map((row, i) => ({ rank: i + 1, name: nameOf(row.regId), wins: row.wins, losses: row.losses, pf: row.pf, pa: row.pa, diff: row.pf - row.pa })),
        }
      })
    }

    const navItems: ManageNavItem[] = [
      { label: 'Overview', href: `/leagues/${params.id}` },
      { label: 'Standings', href: `/leagues/${params.id}/standings` },
      ...(isManager0 ? [
        { label: 'Roster', href: `/leagues/${params.id}/roster` },
        { label: 'Edit', href: `/leagues/${params.id}/edit` },
      ] : []),
    ]
    const anyRows = boxViews.some(b => b.rows.some(r => r.wins + r.losses > 0))

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
            <p className="text-xs text-brand-muted">Per-box standings — win %, then point differential.</p>
          </div>
          {boxViews.length === 0 ? (
            <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
              <p className="text-2xl">🏓</p>
              <p className="text-sm font-medium text-brand-dark">No boxes yet</p>
              <p className="text-xs text-brand-muted">Seed boxes and generate matches on the Roster screen.</p>
            </div>
          ) : (
            <>
              {!anyRows && <p className="text-xs text-brand-muted">No results entered yet — standings start at 0–0.</p>}
              <BoxStandings boxes={boxViews} />
            </>
          )}
        </div>
      </DesktopShell>
    )
  }

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

  // For fixed-partner leagues, merge each pair into one team row
  const partnerMode = (league as any).partner_mode ?? null
  let finalStandings = standings
  if (partnerMode === 'fixed') {
    const partnerByUserId = Object.fromEntries(
      (registrations ?? [])
        .filter(r => (r as any).partner_user_id)
        .map(r => [r.user_id, (r as any).partner_user_id as string])
    )
    const seen = new Set<string>()
    finalStandings = standings
      .filter(row => {
        const partnerId = partnerByUserId[row.userId]
        if (!partnerId) return true
        const canonical = row.userId < partnerId ? `${row.userId}|${partnerId}` : `${partnerId}|${row.userId}`
        if (seen.has(canonical)) return false
        seen.add(canonical)
        return true
      })
      .map(row => {
        const partnerId = partnerByUserId[row.userId]
        if (!partnerId) return row
        const partnerRow = standings.find(s => s.userId === partnerId)
        if (!partnerRow) return row
        const n1 = row.name.split(' ')[0]
        const n2 = partnerRow.name.split(' ')[0]
        const [first, second] = n1.localeCompare(n2) <= 0 ? [n1, n2] : [n2, n1]
        return { ...row, name: `Team ${first}/${second}` }
      })
  }

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
          initialStandings={finalStandings}
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
