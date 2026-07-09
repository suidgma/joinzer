// Loads the fixtures a registered player may score themselves (box / ladder), when the
// league has allow_player_scores on. Returns the player's own matches for the current
// period, from their perspective (my side vs opponent). Service-role read.

import type { SupabaseClient } from '@supabase/supabase-js'

export type PlayerScorableFixture = {
  id: string
  round: number | null
  court: number | null
  mySide: 1 | 2
  oppLabel: string
  status: string
  myScore: number | null
  oppScore: number | null
}

export async function loadPlayerScorableFixtures(admin: SupabaseClient, leagueId: string, userId: string): Promise<PlayerScorableFixture[]> {
  // Current period (latest cycle / ladder session).
  const { data: period } = await admin
    .from('league_periods').select('id').eq('league_id', leagueId)
    .order('period_number', { ascending: false }).limit(1).maybeSingle()
  if (!period) return []

  const [{ data: fixtures }, { data: regs }] = await Promise.all([
    admin.from('league_fixtures')
      .select('id, round_number, court_number, match_stage, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, status')
      .eq('league_id', leagueId).eq('period_id', (period as { id: string }).id)
      .order('round_number', { ascending: true }).order('court_number', { ascending: true }),
    admin.from('league_registrations')
      .select('id, user_id, partner_registration_id, profile:profiles!user_id(name)')
      .eq('league_id', leagueId),
  ])

  const regRows = (regs ?? []) as any[]
  const byId = new Map(regRows.map((r) => [r.id, r]))

  // The user_ids and display names attached to an entrant reg (canonical + its partner).
  const usersOf = (regId: string | null): Set<string> => {
    const out = new Set<string>()
    if (!regId) return out
    const reg = byId.get(regId)
    if (!reg) return out
    if (reg.user_id) out.add(reg.user_id)
    if (reg.partner_registration_id) { const p = byId.get(reg.partner_registration_id); if (p?.user_id) out.add(p.user_id) }
    for (const r of regRows) if (r.partner_registration_id === regId && r.user_id) out.add(r.user_id)
    return out
  }
  const nameOf = (regId: string | null): string => {
    if (!regId) return 'TBD'
    const reg = byId.get(regId)
    if (!reg) return 'TBD'
    const names: string[] = []
    if (reg.profile?.name) names.push(reg.profile.name)
    if (reg.partner_registration_id) { const p = byId.get(reg.partner_registration_id); if (p?.profile?.name) names.push(p.profile.name) }
    for (const r of regRows) if (r.partner_registration_id === regId && r.profile?.name) names.push(r.profile.name)
    return names.length ? [...new Set(names)].join(' / ') : 'Player'
  }

  const out: PlayerScorableFixture[] = []
  for (const f of (fixtures ?? []) as any[]) {
    if (f.match_stage === 'ladder_bye' || !f.team_1_registration_id || !f.team_2_registration_id) continue
    const inSide1 = usersOf(f.team_1_registration_id).has(userId)
    const inSide2 = inSide1 ? false : usersOf(f.team_2_registration_id).has(userId)
    if (!inSide1 && !inSide2) continue
    const mySide: 1 | 2 = inSide1 ? 1 : 2
    out.push({
      id: f.id,
      round: f.round_number ?? null,
      court: f.court_number ?? null,
      mySide,
      oppLabel: nameOf(mySide === 1 ? f.team_2_registration_id : f.team_1_registration_id),
      status: f.status ?? 'scheduled',
      myScore: mySide === 1 ? (f.team_1_score ?? null) : (f.team_2_score ?? null),
      oppScore: mySide === 1 ? (f.team_2_score ?? null) : (f.team_1_score ?? null),
    })
  }
  return out
}
