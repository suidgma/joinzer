import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import DesktopShell from '@/components/ui/desktop-shell'
import ManageNav from '@/components/ui/manage-nav'
import { leagueNavItems } from '@/lib/leagues/leagueNav'
import StandingsTable from './StandingsTable'
import BoxStandings, { type BoxStandingView } from './BoxStandings'
import CycleSelector from './CycleSelector'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import { computeFixtureStandings } from '@/lib/leagues/fixtureStandings'
import { getRunSessionAction } from '@/lib/leagues/runSession'
import { readLadderState } from '@/lib/leagues/ladderServer'
import LadderStandings, { type LadderStandingRow } from './LadderStandings'
import StandingsShareCard from './StandingsShareCard'
import { getBoxPositionTrend, type BoxTrendRow } from '@/lib/leagues/boxTrend'
import BoxPositionTrend from './BoxPositionTrend'
import RecentResults, { type ResultRow } from './RecentResults'
import TeamStandings from './TeamStandings'
import { rankEntities, type RankMatch } from '@/lib/tournament/standings'

export default async function LeagueStandingsPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ cycle?: string }> }) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: league }, { data: registrations }, { data: sessions }] = await Promise.all([
    supabase.from('leagues').select('id, name, format, created_by, sub_credit_cap, standings_method, partner_mode, format_kind, public_standings').eq('id', params.id).single(),
    supabase
      .from('league_registrations')
      .select('user_id, partner_user_id, profile:profiles!user_id(id, name, profile_photo_url)')
      .eq('league_id', params.id)
      .eq('status', 'registered'),
    supabase
      .from('league_sessions')
      .select('id, session_number, session_date, status')
      .eq('league_id', params.id)
      .order('session_date', { ascending: true }),
  ])

  if (!league) notFound()

  const isManager0 = user?.id === league.created_by

  // "Run Session" action for the sidebar (creator only — co-admins get a reduced
  // nav on standings). Format-aware: session live page for round-robin, the active
  // cycle's attendance surface for box.
  const runSessionAction = await getRunSessionAction(params.id, isManager0, (league as any).format_kind)

  // ── Team leagues: rank TEAM entities over completed team_matchup fixtures via the
  //    shared rankEntities core (matchup W–L → line-win differential). ──
  if ((league as any).format_kind === 'team') {
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: teamsRaw } = await admin
      .from('league_teams').select('id, name, status').eq('league_id', params.id)
      .neq('status', 'withdrawn').order('created_at', { ascending: true })
    const teams = (teamsRaw ?? []) as any[]
    const teamNameById = new Map<string, string>(teams.map((t) => [t.id, t.name]))
    const nameOf = (id: string) => teamNameById.get(id) ?? 'Team'

    const { data: matchupsRaw } = teams.length
      ? await admin.from('league_fixtures')
          .select('period_id, round_number, team_1_id, team_2_id, team_1_score, team_2_score, winner_team_id, status')
          .eq('league_id', params.id).eq('match_stage', 'team_matchup')
          .order('round_number', { ascending: true })
      : { data: [] as any[] }
    const matchups = (matchupsRaw ?? []) as any[]

    const rankMatches: RankMatch[] = matchups
      .filter((m) => m.status === 'completed' && m.team_1_id && m.team_2_id)
      .map((m) => ({
        sideAId: m.team_1_id,
        sideBId: m.team_2_id,
        winnerId: m.winner_team_id ?? null,
        scoreA: m.team_1_score ?? 0,
        scoreB: m.team_2_score ?? 0,
      }))
    const ranked = rankEntities(rankMatches, teams.map((t) => t.id), nameOf)
    const rows = ranked.map((r, i) => ({
      rank: i + 1,
      name: nameOf(r.entityId),
      wins: r.wins,
      losses: r.losses,
      winPct: r.wins + r.losses > 0 ? r.wins / (r.wins + r.losses) : 0,
      linesFor: r.pf,
      linesAgainst: r.pa,
      diff: r.pf - r.pa,
    }))
    const hasResults = rankMatches.length > 0

    // Latest matchday's matchup results (line-win tallies).
    const latestRound = matchups.filter((m) => m.status === 'completed').reduce((mx, m) => Math.max(mx, m.round_number ?? 0), 0)
    const recentRows: ResultRow[] = matchups
      .filter((m) => m.status === 'completed' && (m.round_number ?? 0) === latestRound)
      .map((m) => ({
        name1: nameOf(m.team_1_id),
        name2: nameOf(m.team_2_id),
        score1: m.team_1_score ?? 0,
        score2: m.team_2_score ?? 0,
        winner1: m.winner_team_id === m.team_1_id,
      }))

    const navItems = leagueNavItems(params.id, { canManage: isManager0, formatKind: (league as any).format_kind })
    return (
      <DesktopShell
        header={
          <div className="flex items-center gap-3">
            <Link href={`/leagues/${params.id}`} className="text-brand-muted text-sm">← {league.name}</Link>
            <span className="text-brand-muted text-sm">/</span>
            <span className="text-sm font-medium text-brand-dark">Standings/Results</span>
          </div>
        }
        sidebar={<ManageNav items={navItems} primaryAction={runSessionAction} />}
      >
        <ManageNav items={navItems} mobileOnly primaryAction={runSessionAction} />
        <div className="space-y-4 pb-8 max-w-2xl">
          <div>
            <h1 className="font-heading text-xl font-bold text-brand-dark">Standings/Results</h1>
            <p className="text-xs text-brand-muted">Matchup win % → line-win differential.</p>
          </div>
          <StandingsShareCard leagueId={params.id} initialEnabled={(league as any).public_standings === true} canToggle={isManager0} />
          {!hasResults ? (
            <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
              <p className="text-2xl">🏓</p>
              <p className="text-sm font-medium text-brand-dark">No matchups scored yet</p>
              <p className="text-xs text-brand-muted">Create teams and generate the schedule, then standings update as matchups are scored.</p>
            </div>
          ) : (
            <>
              <TeamStandings rows={rows} />
              {recentRows.length > 0 && <RecentResults heading={`Latest results — Matchday ${latestRound}`} rows={recentRows} />}
            </>
          )}
        </div>
      </DesktopShell>
    )
  }

  // ── Flex leagues: self-scheduled round-robin; whole-league standings over the
  //    confirmed fixtures (same registration-entity core as Box, no box scope). ──
  if ((league as any).format_kind === 'flex') {
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const doubles = isDoublesFormat((league as any).format)
    const firstName = (n?: string | null) => (n ? n.trim().split(/\s+/)[0] : '')
    const { data: regsRaw } = await admin
      .from('league_registrations')
      .select('id, status, partner_registration_id, profile:profiles!user_id(name)')
      .eq('league_id', params.id).neq('status', 'cancelled')
    const byRegId = new Map<string, any>((regsRaw ?? []).map((r: any) => [r.id, r]))
    const nameOf = (regId: string): string => {
      const r: any = byRegId.get(regId)
      if (!r) return 'Player'
      const a = firstName(r.profile?.name)
      if (!doubles) return a || 'Player'
      const partner: any = r.partner_registration_id ? byRegId.get(r.partner_registration_id) : null
      const b = partner ? firstName(partner.profile?.name) : ''
      return b ? `${a}/${b}` : (a || 'Team')
    }
    const regsForStandings = (regsRaw ?? []).map((r: any) => ({ id: r.id, status: r.status, partner_registration_id: r.partner_registration_id ?? null }))

    const { data: fxRaw } = await admin
      .from('league_fixtures')
      .select('id, match_stage, round_number, match_number, status, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, winner_registration_id, box_id, period_id, updated_at')
      .eq('league_id', params.id).eq('match_stage', 'round_robin')
    const fixtures = (fxRaw ?? []) as any[]
    const hasResults = fixtures.some((f) => f.status === 'completed')
    const standingRows = computeFixtureStandings(fixtures as any, regsForStandings, {}, nameOf)
    const rows = standingRows.map((row, i) => ({
      rank: i + 1,
      name: nameOf(row.regId),
      movement: null as null,
      wins: row.wins,
      losses: row.losses,
      winPct: row.wins + row.losses > 0 ? row.wins / (row.wins + row.losses) : 0,
      pf: row.pf,
      pa: row.pa,
      diff: row.pf - row.pa,
    }))
    const boxViews: BoxStandingView[] = [{ name: 'Standings', rows }]

    const recentRows: ResultRow[] = fixtures
      .filter((f) => f.status === 'completed' && f.team_1_score != null)
      .sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime())
      .slice(0, 8)
      .map((f) => ({
        name1: nameOf(f.team_1_registration_id),
        name2: nameOf(f.team_2_registration_id),
        score1: f.team_1_score,
        score2: f.team_2_score,
        winner1: f.winner_registration_id === f.team_1_registration_id,
      }))

    const navItems = leagueNavItems(params.id, { canManage: isManager0, formatKind: (league as any).format_kind })
    return (
      <DesktopShell
        header={
          <div className="flex items-center gap-3">
            <Link href={`/leagues/${params.id}`} className="text-brand-muted text-sm">← {league.name}</Link>
            <span className="text-brand-muted text-sm">/</span>
            <span className="text-sm font-medium text-brand-dark">Standings/Results</span>
          </div>
        }
        sidebar={<ManageNav items={navItems} primaryAction={runSessionAction} />}
      >
        <ManageNav items={navItems} mobileOnly primaryAction={runSessionAction} />
        <div className="space-y-4 pb-8 max-w-2xl">
          <div>
            <h1 className="font-heading text-xl font-bold text-brand-dark">Standings/Results</h1>
            <p className="text-xs text-brand-muted">Win % → point differential. Updates as matches are confirmed.</p>
          </div>
          <StandingsShareCard leagueId={params.id} initialEnabled={(league as any).public_standings === true} canToggle={isManager0} />
          {!hasResults ? (
            <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
              <p className="text-2xl">🏓</p>
              <p className="text-sm font-medium text-brand-dark">No results yet</p>
              <p className="text-xs text-brand-muted">Standings appear as players report and confirm their matches.</p>
            </div>
          ) : (
            <>
              <BoxStandings boxes={boxViews} />
              {recentRows.length > 0 && <RecentResults heading="Latest results" rows={recentRows} />}
            </>
          )}
        </div>
      </DesktopShell>
    )
  }

  // ── Ladder leagues: the continuous ranking + movement + rank trend. ──
  if ((league as any).format_kind === 'ladder') {
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const state = await readLadderState(admin, params.id, (league as any).format, (league as any).format_settings_json ?? null)
    const { data: hist } = await admin
      .from('ladder_position_history')
      .select('registration_id, session_number, position_before, position_after, wins, losses')
      .eq('league_id', params.id)
      .order('session_number', { ascending: true })
    const history = (hist ?? []) as any[]
    const latestSession = history.length ? Math.max(...history.map((h) => h.session_number ?? 0)) : 0
    const byReg = new Map<string, any[]>()
    for (const h of history) {
      if (!byReg.has(h.registration_id)) byReg.set(h.registration_id, [])
      byReg.get(h.registration_id)!.push(h)
    }
    // One merged table: current rank + movement + each session's rank (null = sat
    // out) + last-night W-L + trend sparkline.
    const sessionNumbers = [...new Set(history.map((h) => h.session_number as number))].sort((a, b) => a - b)
    const rows: LadderStandingRow[] = state.orderedIds.map((id, i) => {
      const h = byReg.get(id) ?? []
      const last = h.find((x) => x.session_number === latestSession) // their record IN the latest session (if they played)
      const posBySession = new Map<number, number>(h.map((x) => [x.session_number, x.position_after]))
      return {
        rank: i + 1,
        name: state.nameOf(id),
        delta: last ? last.position_before - last.position_after : 0, // 0 = held rank (sat out)
        wins: last?.wins ?? 0,
        losses: last?.losses ?? 0,
        positions: sessionNumbers.map((sn) => posBySession.get(sn) ?? null),
        spark: h.map((x) => -x.position_after), // negate so climbing plots upward
      }
    })

    // Most recent night's court scores.
    const { data: lastPeriod } = await admin
      .from('league_periods').select('id, period_number')
      .eq('league_id', params.id).eq('period_kind', 'ladder_session').eq('status', 'completed')
      .order('period_number', { ascending: false }).limit(1).maybeSingle()
    let recentRows: ResultRow[] = []
    if (lastPeriod) {
      const { data: fx } = await admin
        .from('league_fixtures')
        .select('court_number, round_number, match_stage, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, winner_registration_id')
        .eq('period_id', lastPeriod.id)
      recentRows = (fx ?? [])
        .filter((f: any) => f.match_stage === 'ladder_round' && f.team_1_score != null)
        .sort((a: any, b: any) => (a.round_number - b.round_number) || ((a.court_number ?? 0) - (b.court_number ?? 0)))
        .map((f: any) => ({
          label: f.court_number != null ? `Ct ${f.court_number}` : undefined,
          name1: state.nameOf(f.team_1_registration_id),
          name2: state.nameOf(f.team_2_registration_id),
          score1: f.team_1_score,
          score2: f.team_2_score,
          winner1: f.winner_registration_id === f.team_1_registration_id,
        }))
    }

    const navItems = leagueNavItems(params.id, { canManage: isManager0, formatKind: (league as any).format_kind })
    return (
      <DesktopShell
        header={
          <div className="flex items-center gap-3">
            <Link href={`/leagues/${params.id}`} className="text-brand-muted text-sm">← {league.name}</Link>
            <span className="text-brand-muted text-sm">/</span>
            <span className="text-sm font-medium text-brand-dark">Standings/Results</span>
          </div>
        }
        sidebar={<ManageNav items={navItems} primaryAction={runSessionAction} />}
      >
        <ManageNav items={navItems} mobileOnly primaryAction={runSessionAction} />
        <div className="space-y-4 pb-8 max-w-2xl">
          <div>
            <h1 className="font-heading text-xl font-bold text-brand-dark">Standings/Results</h1>
            <p className="text-xs text-brand-muted">Current rank, movement since the last night (▲/▼), and trend.</p>
          </div>
          <StandingsShareCard leagueId={params.id} initialEnabled={(league as any).public_standings === true} canToggle={isManager0} />
          <LadderStandings rows={rows} periodNumbers={sessionNumbers} />
          {recentRows.length > 0 && <RecentResults heading={`Latest results — Session ${lastPeriod?.period_number}`} rows={recentRows} />}
        </div>
      </DesktopShell>
    )
  }

  // ── Box leagues: per-cycle box standings + match history + promotion/relegation.
  //    Early return keeps the session_rr path below untouched. ?cycle=<id> picks a
  //    past cycle; movement (▲/▼) compares to the following cycle's boxes. ──
  if ((league as any).format_kind === 'box') {
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const boxTrend = await getBoxPositionTrend(admin, params.id, (league as any).format)
    const doubles = isDoublesFormat((league as any).format)
    const firstName = (n?: string | null) => (n ? n.trim().split(/\s+/)[0] : '')

    // All non-cancelled regs (past cycles may include players removed since) — used
    // only for names; box membership is the source of truth for who was in a box.
    const { data: regsRaw } = await admin
      .from('league_registrations')
      .select('id, status, partner_registration_id, profile:profiles!user_id(name)')
      .eq('league_id', params.id).neq('status', 'cancelled')
    const byRegId = new Map((regsRaw ?? []).map((r: any) => [r.id, r]))
    const nameOf = (regId: string): string => {
      const r: any = byRegId.get(regId)
      if (!r) return 'Player'
      const a = firstName(r.profile?.name)
      if (!doubles) return a || 'Player'
      const partner: any = r.partner_registration_id ? byRegId.get(r.partner_registration_id) : null
      const b = partner ? firstName(partner.profile?.name) : ''
      return b ? `${a}/${b}` : (a || 'Team')
    }

    const { data: cyclesRaw } = await admin
      .from('league_periods').select('id, period_number, status')
      .eq('league_id', params.id).eq('period_kind', 'cycle')
      .order('period_number', { ascending: true })
    const cycles = (cyclesRaw ?? []) as any[]
    // Standings reflect FINALIZED results — only completed cycles are shown. The
    // in-progress cycle's live results live on the Run Session surface; a box cycle's
    // standings (and its promotion/relegation) aren't meaningful until it's advanced.
    const completedCycles = cycles.filter(c => c.status === 'completed')
    const selectedCycle = completedCycles.find(c => c.id === searchParams.cycle) ?? completedCycles[completedCycles.length - 1]

    let boxViews: BoxStandingView[] = []
    if (selectedCycle) {
      const { data: bx } = await admin.from('league_boxes').select('id, tier_rank, name').eq('period_id', selectedCycle.id).order('tier_rank', { ascending: true })
      const bxIds = (bx ?? []).map((b: any) => b.id)
      const tierByBox = new Map((bx ?? []).map((b: any) => [b.id, b.tier_rank]))
      const { data: mem } = bxIds.length
        ? await admin.from('league_box_members').select('box_id, registration_id, seed_in_box').in('box_id', bxIds)
        : { data: [] as any[] }
      const memberIdsByBox = new Map<string, string[]>()
      const currentTierByReg = new Map<string, number>()
      for (const m of (mem ?? [])) {
        if (!memberIdsByBox.has(m.box_id)) memberIdsByBox.set(m.box_id, [])
        memberIdsByBox.get(m.box_id)!.push(m.registration_id)
        currentTierByReg.set(m.registration_id, tierByBox.get(m.box_id)!)
      }
      const { data: fx } = bxIds.length
        ? await admin.from('league_fixtures')
            .select('id, status, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, winner_registration_id, box_id, match_stage, round_number, period_id')
            .eq('period_id', selectedCycle.id)
        : { data: [] as any[] }

      // Movement: where did each player land in the next cycle?
      const nextCycle = cycles.find(c => c.period_number === selectedCycle.period_number + 1)
      const nextTierByReg = new Map<string, number>()
      if (nextCycle) {
        const { data: nbx } = await admin.from('league_boxes').select('id, tier_rank').eq('period_id', nextCycle.id)
        const nTierByBox = new Map((nbx ?? []).map((b: any) => [b.id, b.tier_rank]))
        const nbxIds = (nbx ?? []).map((b: any) => b.id)
        const { data: nmem } = nbxIds.length
          ? await admin.from('league_box_members').select('box_id, registration_id').in('box_id', nbxIds)
          : { data: [] as any[] }
        for (const m of (nmem ?? [])) nextTierByReg.set(m.registration_id, nTierByBox.get(m.box_id)!)
      }
      const movementOf = (regId: string): 'up' | 'down' | null => {
        if (!nextCycle) return null
        const cur = currentTierByReg.get(regId), nxt = nextTierByReg.get(regId)
        if (cur == null || nxt == null) return null
        return nxt < cur ? 'up' : nxt > cur ? 'down' : null
      }

      const fxByBox = new Map<string, any[]>()
      for (const f of (fx ?? [])) {
        if (!fxByBox.has(f.box_id)) fxByBox.set(f.box_id, [])
        fxByBox.get(f.box_id)!.push(f)
      }

      // Sub names for this cycle's results — a covered member's matches show the sub
      // who played (round-robin parity), but ONLY when the member was actually being
      // subbed (status 'has_sub'). The member still holds the standings credit.
      const { data: att } = bxIds.length
        ? await admin.from('league_attendance')
            .select('registration_id, user_id, guest_name, status, subbing_for_registration_id')
            .eq('period_id', selectedCycle.id)
        : { data: [] as any[] }
      // A doubles team is one entrant with two slots: a sub covering either partner
      // resolves back to the team's box row, and each slot renders independently
      // ("SubA/SubB" or "SubA/Eliana" when just one player is out).
      const teamRegOf = new Map<string, string>()
      for (const m of (mem ?? [])) {
        const regA = m.registration_id
        teamRegOf.set(regA, regA)
        const partnerRid = (byRegId.get(regA) as any)?.partner_registration_id
        if (partnerRid) teamRegOf.set(partnerRid, regA)
      }
      const coveredRegs = new Set((att ?? []).filter((a: any) => a.status === 'has_sub' && a.registration_id).map((a: any) => a.registration_id))
      const subRows = (att ?? []).filter((a: any) => {
        const teamReg = a.subbing_for_registration_id ? teamRegOf.get(a.subbing_for_registration_id) : undefined
        return teamReg && coveredRegs.has(teamReg)
      })
      const subUserIds = [...new Set(subRows.map((a: any) => a.user_id).filter(Boolean))] as string[]
      const { data: subProfiles } = subUserIds.length
        ? await admin.from('profiles').select('id, name').in('id', subUserIds)
        : { data: [] as any[] }
      const subNameByUser = new Map((subProfiles ?? []).map((p: any) => [p.id, p.name]))
      const subNameBySlotReg = new Map<string, string>()
      for (const a of subRows) {
        const nm = a.registration_id ? nameOf(a.registration_id) : (a.user_id ? (subNameByUser.get(a.user_id) ?? 'Sub') : (a.guest_name ?? 'Guest'))
        subNameBySlotReg.set(a.subbing_for_registration_id, firstName(nm) || nm)
      }
      const matchName = (regId: string | null): string => {
        if (!regId) return nameOf(regId as string)
        if (!doubles) return subNameBySlotReg.get(regId) ?? nameOf(regId)
        const slotName = (rid: string | null): string =>
          rid ? (subNameBySlotReg.get(rid) ?? (firstName((byRegId.get(rid) as any)?.profile?.name) || '')) : ''
        const partnerRegId = (byRegId.get(regId) as any)?.partner_registration_id ?? null
        const a = slotName(regId)
        const b = partnerRegId ? slotName(partnerRegId) : ''
        return b ? `${a}/${b}` : (a || nameOf(regId))
      }

      boxViews = (bx ?? []).map((b: any) => {
        // Box membership is the historical truth (force 'registered' so past
        // members show even if their registration status later changed).
        const memberIds = memberIdsByBox.get(b.id) ?? []
        const regsForBox = memberIds.map((id: string) => ({ id, status: 'registered', partner_registration_id: byRegId.get(id)?.partner_registration_id ?? null }))
        const rows = computeFixtureStandings((fx ?? []) as any, regsForBox, { boxId: b.id }, nameOf)
        const matches = (fxByBox.get(b.id) ?? [])
          .filter((f: any) => f.status === 'completed' && f.team_1_score != null)
          .map((f: any) => ({
            id: f.id,
            round: f.round_number ?? null,
            name1: matchName(f.team_1_registration_id),
            name2: matchName(f.team_2_registration_id),
            score1: f.team_1_score,
            score2: f.team_2_score,
            winner1: f.winner_registration_id === f.team_1_registration_id,
          }))
        return {
          name: b.name ?? `Box ${b.tier_rank}`,
          rows: rows.map((row, i) => ({
            rank: i + 1,
            name: nameOf(row.regId),
            movement: movementOf(row.regId),
            wins: row.wins,
            losses: row.losses,
            winPct: (row.wins + row.losses) > 0 ? row.wins / (row.wins + row.losses) : 0,
            pf: row.pf,
            pa: row.pa,
            diff: row.pf - row.pa,
          })),
          matches,
        }
      })
    }

    const navItems = leagueNavItems(params.id, { canManage: isManager0, formatKind: (league as any).format_kind })
    const isPast = selectedCycle && selectedCycle.status !== 'active'

    return (
      <DesktopShell
        header={
          <div className="flex items-center gap-3">
            <Link href={`/leagues/${params.id}`} className="text-brand-muted text-sm">← {league.name}</Link>
            <span className="text-brand-muted text-sm">/</span>
            <span className="text-sm font-medium text-brand-dark">Standings/Results</span>
          </div>
        }
        sidebar={<ManageNav items={navItems} primaryAction={runSessionAction} />}
      >
        <ManageNav items={navItems} mobileOnly primaryAction={runSessionAction} />
        <div className="space-y-5 pb-8 max-w-2xl">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <h1 className="font-heading text-xl font-bold text-brand-dark">Standings/Results</h1>
              <p className="text-xs text-brand-muted">
                Per-box — win %, then point differential.{isPast ? ' Finished cycle (▲ promoted · ▼ relegated).' : ''}
              </p>
            </div>
            {completedCycles.length > 1 && selectedCycle && (
              <CycleSelector
                cycles={completedCycles.map(c => ({ id: c.id, number: c.period_number, active: false }))}
                selectedId={selectedCycle.id}
              />
            )}
          </div>
          <StandingsShareCard leagueId={params.id} initialEnabled={(league as any).public_standings === true} canToggle={isManager0} />
          {boxTrend.cycleNumbers.length >= 1 && <BoxPositionTrend rows={boxTrend.rows} periodNumbers={boxTrend.cycleNumbers} />}
          {!selectedCycle ? (
            <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
              <p className="text-2xl">📊</p>
              <p className="text-sm font-medium text-brand-dark">No completed cycles yet</p>
              <p className="text-xs text-brand-muted">Standings appear once a cycle is completed. Run the current cycle from Run Session, then advance it.</p>
            </div>
          ) : boxViews.length === 0 ? (
            <div className="bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
              <p className="text-2xl">🏓</p>
              <p className="text-sm font-medium text-brand-dark">No boxes yet</p>
              <p className="text-xs text-brand-muted">Seed boxes and generate matches on the Roster screen.</p>
            </div>
          ) : (
            <BoxStandings boxes={boxViews} />
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
          .select('id, user_id, session_id, actual_status, sub_for_session_player_id')
          .in('session_id', sessionIds)
          .not('sub_for_session_player_id', 'is', null)
      : Promise.resolve({ data: [] }),
  ])

  // Build sub redirect maps
  const absentSpIds = (subSessionPlayers ?? []).map(s => s.sub_for_session_player_id as string).filter(Boolean)
  const { data: absentSpRows } = absentSpIds.length > 0
    ? await supabase.from('league_session_players').select('id, user_id, actual_status').in('id', absentSpIds)
    : { data: [] }
  const absentBySpId = new Map((absentSpRows ?? []).map(p => [p.id as string, { userId: p.user_id as string, status: p.actual_status as string }]))

  // A sub assignment only redirects/caps credit when it's actually in effect: the sub
  // showed up (played) AND the covered player did NOT. If the organizer reverted the
  // covered player to a present status mid-session, they played their own matches, so
  // they keep full credit even if a stale sub link still points at them.
  const isPlaying = (status: string | null | undefined) => status === 'present' || status === 'coming' || status === 'late'
  type SubInfo = { subToAbsent: Map<string, string>; absentUserIds: Set<string> }
  const subInfoBySession = new Map<string, SubInfo>()
  for (const sp of subSessionPlayers ?? []) {
    const sid = sp.session_id as string
    const subUid = sp.user_id as string
    const covered = absentBySpId.get(sp.sub_for_session_player_id as string)
    const absentUid = covered?.userId
    if (!subUid || !absentUid) continue
    if (!isPlaying(sp.actual_status as string)) continue   // sub didn't play → nothing to transfer
    if (isPlaying(covered?.status)) continue               // covered player played for themselves → no cap
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
  const sessionPA  = new Map<string, Map<string, number>>() // points against per session (for cumulative diff)
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

      if (!sessionPA.has(effectivePid)) sessionPA.set(effectivePid, new Map())
      const byPA = sessionPA.get(effectivePid)!
      byPA.set(m.session_id, (byPA.get(m.session_id) ?? 0) + against)

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

  // Most recent week's match scores (the "show the scores for the latest week" bit).
  const latestRRSession = sessionsWithData[sessionsWithData.length - 1]
  let recentRows: ResultRow[] = []
  if (latestRRSession) {
    const latestMatches = (matches ?? []).filter((m) => m.session_id === latestRRSession.id && m.team1_score != null)
    const pids = new Set<string>()
    for (const m of latestMatches) for (const pid of [m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id]) if (pid) pids.add(pid as string)
    const { data: profs } = pids.size
      ? await supabase.from('profiles').select('id, name').in('id', [...pids])
      : { data: [] as any[] }
    const nameById = new Map((profs ?? []).map((p: any) => [p.id, (p.name || '').trim().split(/\s+/)[0] || 'Player']))
    const nm = (id: string | null) => (id ? (nameById.get(id) ?? 'Player') : '')
    recentRows = latestMatches.map((m) => ({
      name1: [m.team1_player1_id, m.team1_player2_id].filter(Boolean).map((id) => nm(id as string)).join('/'),
      name2: [m.team2_player1_id, m.team2_player2_id].filter(Boolean).map((id) => nm(id as string)).join('/'),
      score1: m.team1_score as number,
      score2: m.team2_score as number,
      winner1: (m.team1_score as number) > (m.team2_score as number),
    }))
  }

  // Cumulative standings rank after each week — the "position by week" grid that
  // leads the page (the full sortable table stays below for the detail). Only ranks
  // players who have played through that week; unplayed weeks show "—".
  const rrCum = new Map<string, { pf: number; pa: number; wins: number; losses: number }>()
  for (const e of finalStandings) rrCum.set(e.userId, { pf: 0, pa: 0, wins: 0, losses: 0 })
  const rrRankByUser = new Map<string, Map<string, number>>()
  for (const s of sessionsWithData) {
    for (const e of finalStandings) {
      const c = rrCum.get(e.userId)!
      c.pf += sessionPts.get(e.userId)?.get(s.id) ?? 0
      c.pa += sessionPA.get(e.userId)?.get(s.id) ?? 0
      const wl = sessionWL.get(e.userId)?.get(s.id)
      if (wl) { c.wins += wl.wins; c.losses += wl.losses }
    }
    const ranked = finalStandings
      .map((e) => { const c = rrCum.get(e.userId)!; const games = c.wins + c.losses; return { userId: e.userId, points: c.pf, diff: c.pf - c.pa, winPct: games > 0 ? c.wins / games : 0, games } })
      .filter((r) => r.games > 0)
      .sort((a, b) => standingsMethod === 'total_points'
        ? b.points - a.points || b.diff - a.diff || b.winPct - a.winPct
        : b.winPct - a.winPct || b.diff - a.diff || b.points - a.points)
    ranked.forEach((r, i) => {
      if (!rrRankByUser.has(r.userId)) rrRankByUser.set(r.userId, new Map())
      rrRankByUser.get(r.userId)!.set(s.id, i + 1)
    })
  }
  const rrWeekNumbers = sessionsWithData.map((s) => s.session_number as number)
  const rrTrendRows: BoxTrendRow[] = finalStandings.map((e, idx) => ({
    regId: e.userId,
    name: e.name,
    positions: sessionsWithData.map((s) => rrRankByUser.get(e.userId)?.get(s.id) ?? null),
    current: idx + 1,
  }))

  const navItems = leagueNavItems(params.id, { canManage: isManager, formatKind: (league as any).format_kind })

  return (
    <DesktopShell
      header={
        <div className="flex items-center gap-3">
          <Link href={`/leagues/${params.id}`} className="text-brand-muted text-sm">← {league.name}</Link>
          <span className="text-brand-muted text-sm">/</span>
          <span className="text-sm font-medium text-brand-dark">Standings/Results</span>
        </div>
      }
      sidebar={<ManageNav items={navItems} primaryAction={runSessionAction} />}
    >
      <ManageNav items={navItems} mobileOnly primaryAction={runSessionAction} />
      <div className="space-y-6 pb-8">

      <div>
        <h1 className="font-heading text-xl font-bold text-brand-dark">Standings/Results</h1>
        <p className="text-xs text-brand-muted">
          Sorted by points scored by default. Click any column header to re-sort.
        </p>
      </div>

      <StandingsShareCard leagueId={params.id} initialEnabled={(league as any).public_standings === true} canToggle={isManager} />

      {hasResults && rrWeekNumbers.length >= 1 && (
        <BoxPositionTrend rows={rrTrendRows} periodNumbers={rrWeekNumbers} />
      )}

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

      {recentRows.length > 0 && latestRRSession && (
        <RecentResults heading={`Latest results — Wk ${latestRRSession.session_number}`} rows={recentRows} />
      )}
      </div>
    </DesktopShell>
  )
}
