// Extract normalized GameRecords from Joinzer's competitive match data — round-robin
// (league_matches), box/ladder (league_fixtures), and tournaments (tournament_matches).
// READ-ONLY. The pure `*ToGames` transforms are unit-tested; the `extract*` fetchers are
// thin DB wrappers around them. Casual/open play is intentionally excluded.
// See docs/phases/rating-engine-phase2.md §2. NOT wired to anything yet.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isDoublesFormat } from '../taxonomy/formats'
import type { GameRecord, RatingFormat } from './types'

type RegInfo = { user_id: string | null; partner_user_id: string | null }

// ── Pure transforms ─────────────────────────────────────────────────────────────

// Round-robin leagues: `*_player*_id` are already user_ids (subs are the physical player).
export function rrMatchesToGames(
  matches: any[],
  sessions: Map<string, { session_date: string; league_id: string }>,
  leagueFormat: Map<string, string>,
): GameRecord[] {
  const out: GameRecord[] = []
  for (const m of matches) {
    if (m.team1_score == null || m.team2_score == null || m.team1_score === m.team2_score) continue
    const s = sessions.get(m.session_id)
    if (!s) continue
    const format: RatingFormat = isDoublesFormat(leagueFormat.get(s.league_id)) ? 'doubles' : 'singles'
    const sideA = [m.team1_player1_id, m.team1_player2_id].filter(Boolean) as string[]
    const sideB = [m.team2_player1_id, m.team2_player2_id].filter(Boolean) as string[]
    if (!sideA.length || !sideB.length) continue
    out.push({
      id: `lm:${m.id}`, playedAt: s.session_date, activity: 'pickleball', format,
      source: 'league', competitionId: s.league_id, occasionId: m.session_id,
      sideA, sideB, winner: m.team1_score > m.team2_score ? 'A' : 'B',
    })
  }
  return out
}

// Box + ladder leagues: fixtures reference stable entrant registrations.
// v1 limitation: rates the covered ENTRANT, not the physical sub (sub overlay deferred).
export function fixturesToGames(
  fixtures: any[],
  regs: Map<string, RegInfo>,
  leagueFormat: Map<string, string>,
): GameRecord[] {
  const out: GameRecord[] = []
  for (const f of fixtures) {
    if (f.status !== 'completed') continue
    if (!f.team_1_registration_id || !f.team_2_registration_id) continue
    if (f.match_stage === 'ladder_bye') continue
    if (f.team_1_score == null || f.team_2_score == null || f.team_1_score === f.team_2_score) continue
    const format: RatingFormat = isDoublesFormat(leagueFormat.get(f.league_id)) ? 'doubles' : 'singles'
    const players = (regId: string): string[] => {
      const r = regs.get(regId)
      if (!r?.user_id) return []
      const users = [r.user_id]
      if (format === 'doubles' && r.partner_user_id) users.push(r.partner_user_id)
      return users
    }
    const sideA = players(f.team_1_registration_id)
    const sideB = players(f.team_2_registration_id)
    if (!sideA.length || !sideB.length) continue
    const winner: 'A' | 'B' =
      f.winner_registration_id === f.team_1_registration_id ? 'A'
        : f.winner_registration_id === f.team_2_registration_id ? 'B'
          : f.team_1_score > f.team_2_score ? 'A' : 'B'
    out.push({
      id: `lf:${f.id}`, playedAt: f.updated_at, activity: 'pickleball', format,
      source: 'league', competitionId: f.league_id, occasionId: f.period_id,
      sideA, sideB, winner,
    })
  }
  return out
}

// Tournaments: fixed doubles use partner_user_id; rotating doubles use the four
// registration ids (team_*_partner_registration_id). Excludes BYEs, drafts, placeholders.
export function tournamentMatchesToGames(
  matches: any[],
  regs: Map<string, RegInfo>,
  divisions: Map<string, { team_type: string; category: string }>,
): GameRecord[] {
  const out: GameRecord[] = []
  for (const m of matches) {
    if (m.status !== 'completed') continue
    if (!m.team_1_registration_id || !m.team_2_registration_id) continue
    if (m.is_draft) continue
    if (m.team_1_source != null || m.team_2_source != null) continue
    if (m.team_1_score == null || m.team_2_score == null || m.team_1_score === m.team_2_score) continue
    const div = divisions.get(m.division_id)
    const format: RatingFormat =
      div && (div.team_type === 'doubles' || (div.category ?? '').includes('doubles')) ? 'doubles' : 'singles'
    const players = (regId: string | null, partnerRegId: string | null): string[] => {
      if (!regId) return []
      const r = regs.get(regId)
      if (!r?.user_id) return []
      const users = [r.user_id]
      if (format === 'doubles') {
        if (partnerRegId) { const p = regs.get(partnerRegId); if (p?.user_id) users.push(p.user_id) }
        else if (r.partner_user_id) users.push(r.partner_user_id)
      }
      return users
    }
    const sideA = players(m.team_1_registration_id, m.team_1_partner_registration_id ?? null)
    const sideB = players(m.team_2_registration_id, m.team_2_partner_registration_id ?? null)
    if (!sideA.length || !sideB.length) continue
    const winner: 'A' | 'B' =
      m.winner_registration_id === m.team_1_registration_id ? 'A'
        : m.winner_registration_id === m.team_2_registration_id ? 'B'
          : m.team_1_score > m.team_2_score ? 'A' : 'B'
    out.push({
      id: `tm:${m.id}`, playedAt: m.scheduled_time ?? m.updated_at, activity: 'pickleball', format,
      source: 'tournament', competitionId: m.tournament_id, occasionId: m.tournament_id,
      sideA, sideB, winner,
    })
  }
  return out
}

// ── Read-only DB fetchers ───────────────────────────────────────────────────────

export async function extractLeagueGames(admin: SupabaseClient): Promise<GameRecord[]> {
  const [{ data: leagues }, { data: sessions }, { data: regs }] = await Promise.all([
    admin.from('leagues').select('id, format'),
    admin.from('league_sessions').select('id, session_date, league_id'),
    admin.from('league_registrations').select('id, user_id, partner_user_id').neq('status', 'cancelled'),
  ])
  const leagueFormat = new Map<string, string>((leagues ?? []).map((l: any) => [l.id, l.format]))
  const sessionMap = new Map<string, { session_date: string; league_id: string }>(
    (sessions ?? []).map((s: any) => [s.id, { session_date: s.session_date, league_id: s.league_id }]),
  )
  const regMap = new Map<string, RegInfo>((regs ?? []).map((r: any) => [r.id, { user_id: r.user_id, partner_user_id: r.partner_user_id }]))

  const [{ data: matches }, { data: fixtures }] = await Promise.all([
    admin.from('league_matches')
      .select('id, session_id, team1_player1_id, team1_player2_id, team2_player1_id, team2_player2_id, team1_score, team2_score')
      .not('team1_score', 'is', null),
    admin.from('league_fixtures')
      .select('id, league_id, period_id, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, winner_registration_id, status, match_stage, updated_at')
      .eq('status', 'completed'),
  ])

  return [
    ...rrMatchesToGames(matches ?? [], sessionMap, leagueFormat),
    ...fixturesToGames(fixtures ?? [], regMap, leagueFormat),
  ]
}

export async function extractTournamentGames(admin: SupabaseClient): Promise<GameRecord[]> {
  const [{ data: divisions }, { data: regs }] = await Promise.all([
    admin.from('tournament_divisions').select('id, team_type, category'),
    admin.from('tournament_registrations').select('id, user_id, partner_user_id'),
  ])
  const divMap = new Map<string, { team_type: string; category: string }>(
    (divisions ?? []).map((d: any) => [d.id, { team_type: d.team_type, category: d.category }]),
  )
  const regMap = new Map<string, RegInfo>((regs ?? []).map((r: any) => [r.id, { user_id: r.user_id, partner_user_id: r.partner_user_id }]))

  const { data: matches } = await admin
    .from('tournament_matches')
    .select('id, tournament_id, division_id, team_1_registration_id, team_2_registration_id, team_1_partner_registration_id, team_2_partner_registration_id, team_1_score, team_2_score, winner_registration_id, status, is_draft, team_1_source, team_2_source, scheduled_time, updated_at')
    .eq('status', 'completed')

  return tournamentMatchesToGames(matches ?? [], regMap, divMap)
}

export async function extractAllGameRecords(admin: SupabaseClient): Promise<GameRecord[]> {
  const [league, tournament] = await Promise.all([extractLeagueGames(admin), extractTournamentGames(admin)])
  return [...league, ...tournament]
}
