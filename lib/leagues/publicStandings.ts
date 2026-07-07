// Server-side standings getters for the PUBLIC (no-login) results page at /l/[id].
// Reads via the service role (standings tables are RLS deny-all) and returns the
// same props the authenticated standings components already render — first-name
// masked, PII-safe (no email/phone/exact location). One getter per format.

import { isDoublesFormat } from '@/lib/taxonomy/formats'
import { computeFixtureStandings } from '@/lib/leagues/fixtureStandings'
import { readLadderState, type ladderAdmin } from '@/lib/leagues/ladderServer'
import type { LadderStandingRow } from '@/app/(app)/leagues/[id]/standings/LadderStandings'
import type { BoxStandingView } from '@/app/(app)/leagues/[id]/standings/BoxStandings'

type Admin = ReturnType<typeof ladderAdmin>
const firstName = (n?: string | null) => (n ? n.trim().split(/\s+/)[0] : '')

// ── Ladder ────────────────────────────────────────────────────────────────────
export async function getLadderPublicStandings(admin: Admin, leagueId: string, format: string | null, settings: Record<string, unknown> | null) {
  const state = await readLadderState(admin, leagueId, format, settings)
  const { data: hist } = await admin
    .from('ladder_position_history')
    .select('registration_id, session_number, position_before, position_after, wins, losses')
    .eq('league_id', leagueId)
    .order('session_number', { ascending: true })
  const history = (hist ?? []) as any[]
  const hasHistory = history.length > 0
  const latestSession = history.length ? Math.max(...history.map((h) => h.session_number ?? 0)) : 0
  const byReg = new Map<string, any[]>()
  for (const h of history) {
    if (!byReg.has(h.registration_id)) byReg.set(h.registration_id, [])
    byReg.get(h.registration_id)!.push(h)
  }
  const rows: LadderStandingRow[] = state.orderedIds.map((id, i) => {
    const h = byReg.get(id) ?? []
    const last = h.find((x) => x.session_number === latestSession)
    return {
      rank: i + 1,
      name: state.nameOf(id),
      prior: last ? last.position_before : null,
      delta: last ? last.position_before - last.position_after : 0,
      wins: last?.wins ?? 0,
      losses: last?.losses ?? 0,
      spark: h.map((x) => -x.position_after),
    }
  })
  return { rows, hasHistory }
}

// ── Box (latest completed cycle) ─────────────────────────────────────────────
export async function getBoxPublicStandings(admin: Admin, leagueId: string, format: string | null) {
  const doubles = isDoublesFormat(format)
  const { data: regsRaw } = await admin
    .from('league_registrations')
    .select('id, status, partner_registration_id, profile:profiles!user_id(name)')
    .eq('league_id', leagueId)
    .neq('status', 'cancelled')
  const byRegId = new Map<string, any>((regsRaw ?? []).map((r: any) => [r.id, r]))
  const nameOf = (regId: string | null): string => {
    if (!regId) return 'Player'
    const r = byRegId.get(regId)
    if (!r) return 'Player'
    const a = firstName(r.profile?.name)
    if (!doubles) return a || 'Player'
    const partner = r.partner_registration_id ? byRegId.get(r.partner_registration_id) : null
    const b = partner ? firstName(partner.profile?.name) : ''
    return b ? `${a}/${b}` : a || 'Team'
  }

  const { data: cyclesRaw } = await admin
    .from('league_periods').select('id, period_number, status')
    .eq('league_id', leagueId).eq('period_kind', 'cycle').order('period_number', { ascending: true })
  const completed = (cyclesRaw ?? []).filter((c: any) => c.status === 'completed')
  const cycle = completed[completed.length - 1]
  if (!cycle) return { boxes: [] as BoxStandingView[], cycleNumber: null as number | null }

  const { data: bx } = await admin.from('league_boxes').select('id, tier_rank, name').eq('period_id', cycle.id).order('tier_rank', { ascending: true })
  const bxIds = (bx ?? []).map((b: any) => b.id)
  const { data: mem } = bxIds.length
    ? await admin.from('league_box_members').select('box_id, registration_id, seed_in_box').in('box_id', bxIds)
    : { data: [] as any[] }
  const memberIdsByBox = new Map<string, string[]>()
  for (const m of mem ?? []) {
    if (!memberIdsByBox.has(m.box_id)) memberIdsByBox.set(m.box_id, [])
    memberIdsByBox.get(m.box_id)!.push(m.registration_id)
  }
  const { data: fx } = bxIds.length
    ? await admin.from('league_fixtures')
        .select('id, status, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, winner_registration_id, box_id, round_number')
        .eq('period_id', cycle.id)
    : { data: [] as any[] }

  const boxes: BoxStandingView[] = (bx ?? []).map((b: any) => {
    const memberIds = memberIdsByBox.get(b.id) ?? []
    const regsForBox = memberIds.map((id: string) => ({ id, status: 'registered', partner_registration_id: byRegId.get(id)?.partner_registration_id ?? null }))
    const rows = computeFixtureStandings((fx ?? []) as any, regsForBox as any, { boxId: b.id }, nameOf)
    const matches = (fx ?? [])
      .filter((f: any) => f.box_id === b.id && f.status === 'completed' && f.team_1_score != null)
      .map((f: any) => ({
        id: f.id, round: f.round_number ?? null,
        name1: nameOf(f.team_1_registration_id), name2: nameOf(f.team_2_registration_id),
        score1: f.team_1_score, score2: f.team_2_score,
        winner1: f.winner_registration_id === f.team_1_registration_id,
      }))
    return {
      name: b.name ?? `Box ${b.tier_rank}`,
      rows: rows.map((row, i) => ({
        rank: i + 1, name: nameOf(row.regId), movement: null,
        wins: row.wins, losses: row.losses,
        winPct: row.wins + row.losses > 0 ? row.wins / (row.wins + row.losses) : 0,
        pf: row.pf, pa: row.pa, diff: row.pf - row.pa,
      })),
      matches,
    }
  })
  return { boxes, cycleNumber: cycle.period_number as number }
}

// ── Round-robin (session_rr) ─────────────────────────────────────────────────
export async function getRRPublicStandings(admin: Admin, leagueId: string, subCreditCap: number, standingsMethod: 'win_loss' | 'total_points', partnerMode: string | null) {
  const [{ data: registrations }, { data: sessions }] = await Promise.all([
    admin.from('league_registrations').select('user_id, partner_user_id, profile:profiles!user_id(id, name)').eq('league_id', leagueId).eq('status', 'registered'),
    admin.from('league_sessions').select('id, session_number').eq('league_id', leagueId).order('session_date', { ascending: true }),
  ])
  const sessionIds = (sessions ?? []).map((s: any) => s.id)
  const sessionOrder = new Map((sessions ?? []).map((s: any, i: number) => [s.id, i]))

  const [{ data: matches }, { data: subSessionPlayers }] = await Promise.all([
    sessionIds.length
      ? admin.from('league_matches').select('session_id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, team1_score, team2_score').in('session_id', sessionIds).not('team1_score', 'is', null)
      : Promise.resolve({ data: [] as any[] }),
    sessionIds.length
      ? admin.from('league_session_players').select('id, user_id, session_id, sub_for_session_player_id').in('session_id', sessionIds).not('sub_for_session_player_id', 'is', null)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const absentSpIds = (subSessionPlayers ?? []).map((s: any) => s.sub_for_session_player_id).filter(Boolean)
  const { data: absentSpRows } = absentSpIds.length
    ? await admin.from('league_session_players').select('id, user_id').in('id', absentSpIds)
    : { data: [] as any[] }
  const absentUserBySpId = new Map((absentSpRows ?? []).map((p: any) => [p.id, p.user_id]))

  const subInfoBySession = new Map<string, { subToAbsent: Map<string, string>; absentUserIds: Set<string> }>()
  for (const sp of subSessionPlayers ?? []) {
    const sid = sp.session_id, subUid = sp.user_id, absentUid = absentUserBySpId.get(sp.sub_for_session_player_id)
    if (!subUid || !absentUid) continue
    if (!subInfoBySession.has(sid)) subInfoBySession.set(sid, { subToAbsent: new Map(), absentUserIds: new Set() })
    const info = subInfoBySession.get(sid)!
    info.subToAbsent.set(subUid, absentUid)
    info.absentUserIds.add(absentUid)
  }

  type Stats = { points: number; pointsAgainst: number; games: number; wins: number; losses: number; matchResults: { order: number; won: boolean }[] }
  const statsMap = new Map<string, Stats>()
  const sessionPts: Record<string, Record<string, number>> = {}
  const sessionWL: Record<string, Record<string, { wins: number; losses: number }>> = {}
  for (const reg of registrations ?? []) statsMap.set(reg.user_id, { points: 0, pointsAgainst: 0, games: 0, wins: 0, losses: 0, matchResults: [] })

  for (const m of matches ?? []) {
    if (m.team1_score == null || m.team2_score == null) continue
    const team1 = [m.team1_player1_id, m.team1_player2_id].filter(Boolean)
    const team2 = [m.team2_player1_id, m.team2_player2_id].filter(Boolean)
    const info = subInfoBySession.get(m.session_id)
    const team1Won = m.team1_score > m.team2_score
    const order = sessionOrder.get(m.session_id) ?? 0
    const apply = (pid: string, pts: number, against: number, won: boolean) => {
      let epid = pid, epts = pts
      if (info) {
        const absentUid = info.subToAbsent.get(pid)
        if (absentUid) { epid = absentUid; epts = Math.min(pts, subCreditCap) }
        else if (info.absentUserIds.has(pid)) epts = Math.min(pts, subCreditCap)
      }
      const s = statsMap.get(epid) ?? { points: 0, pointsAgainst: 0, games: 0, wins: 0, losses: 0, matchResults: [] }
      s.games++; s.points += epts; s.pointsAgainst += against
      if (won) s.wins++; else s.losses++
      s.matchResults.push({ order, won })
      statsMap.set(epid, s)
      ;(sessionPts[epid] ??= {})[m.session_id] = (sessionPts[epid][m.session_id] ?? 0) + epts
      const wl = (sessionWL[epid] ??= {})[m.session_id] ?? { wins: 0, losses: 0 }
      sessionWL[epid][m.session_id] = { wins: wl.wins + (won ? 1 : 0), losses: wl.losses + (won ? 0 : 1) }
    }
    for (const pid of team1) if (pid) apply(pid, m.team1_score, m.team2_score, team1Won)
    for (const pid of team2) if (pid) apply(pid, m.team2_score, m.team1_score, !team1Won)
  }

  const computeStreak = (results: { order: number; won: boolean }[]) => {
    if (!results.length) return null
    const sorted = [...results].sort((a, b) => a.order - b.order)
    const last = sorted[sorted.length - 1]
    let count = 0
    for (let i = sorted.length - 1; i >= 0; i--) { if (sorted[i].won === last.won) count++; else break }
    return { type: (last.won ? 'W' : 'L') as 'W' | 'L', count }
  }

  let standings = (registrations ?? []).map((r: any) => {
    const p = r.profile as { id: string; name: string }
    const s = statsMap.get(r.user_id) ?? { points: 0, pointsAgainst: 0, games: 0, wins: 0, losses: 0, matchResults: [] }
    const winPct = s.games > 0 ? s.wins / s.games : 0
    // PII: first name only for the public view.
    return { id: p.id, userId: r.user_id, name: firstName(p.name) || 'Player', profile_photo_url: null as string | null, ...s, streak: computeStreak(s.matchResults), winPct, diff: s.points - s.pointsAgainst }
  }).sort((a, b) => standingsMethod === 'total_points'
    ? b.points - a.points || b.diff - a.diff || b.winPct - a.winPct
    : b.winPct - a.winPct || b.diff - a.diff || b.points - a.points)

  if (partnerMode === 'fixed') {
    const partnerByUserId = Object.fromEntries((registrations ?? []).filter((r: any) => r.partner_user_id).map((r: any) => [r.user_id, r.partner_user_id]))
    const seen = new Set<string>()
    standings = standings.filter((row) => {
      const pid = partnerByUserId[row.userId]
      if (!pid) return true
      const key = row.userId < pid ? `${row.userId}|${pid}` : `${pid}|${row.userId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).map((row) => {
      const pid = partnerByUserId[row.userId]
      const partnerRow = pid ? standings.find((s) => s.userId === pid) : null
      if (!partnerRow) return row
      const [x, y] = [row.name, partnerRow.name].sort((a, b) => a.localeCompare(b))
      return { ...row, name: `${x}/${y}` }
    })
  }

  const sessionsWithData = (sessions ?? []).filter((s: any) => (matches ?? []).some((m: any) => m.session_id === s.id)).map((s: any) => ({ id: s.id, session_number: s.session_number }))
  const hasResults = (matches ?? []).length > 0
  return { standings, sessionsWithData, sessionPts, sessionWL, standingsMethod, hasResults }
}
