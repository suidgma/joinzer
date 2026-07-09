// Loads the team-league lines a registered player may score themselves, when the league
// has allow_player_scores on. Returns the player's own lines in the current matchday,
// from their perspective (my side vs the opposing line players). Service-role read.

import type { SupabaseClient } from '@supabase/supabase-js'

export type PlayerTeamLine = {
  lineId: string
  matchupId: string
  lineLabel: string
  oppLabel: string
  mySide: 1 | 2
  myScore: number | null
  oppScore: number | null
}

export async function loadPlayerTeamLines(admin: SupabaseClient, leagueId: string, userId: string): Promise<PlayerTeamLine[]> {
  const { data: myReg } = await admin
    .from('league_registrations').select('id').eq('league_id', leagueId).eq('user_id', userId).maybeSingle()
  if (!myReg) return []
  const regId = (myReg as { id: string }).id

  const { data: period } = await admin
    .from('league_periods').select('id').eq('league_id', leagueId)
    .order('period_number', { ascending: false }).limit(1).maybeSingle()
  if (!period) return []

  const { data: lines } = await admin
    .from('league_fixtures')
    .select('id, parent_fixture_id, match_number, team_1_registration_id, team_1_partner_registration_id, team_2_registration_id, team_2_partner_registration_id, team_1_score, team_2_score')
    .eq('league_id', leagueId).eq('match_stage', 'team_line').eq('period_id', (period as { id: string }).id)
    .or(`team_1_registration_id.eq.${regId},team_1_partner_registration_id.eq.${regId},team_2_registration_id.eq.${regId},team_2_partner_registration_id.eq.${regId}`)
  const lineRows = (lines ?? []) as any[]
  if (lineRows.length === 0) return []

  const allRegIds = [...new Set(lineRows.flatMap((l) =>
    [l.team_1_registration_id, l.team_1_partner_registration_id, l.team_2_registration_id, l.team_2_partner_registration_id].filter(Boolean)))]
  const { data: regs } = await admin.from('league_registrations').select('id, profile:profiles!user_id(name)').in('id', allRegIds)
  const nameById = new Map((regs ?? []).map((r: any) => [r.id, r.profile?.name ?? 'Player']))

  return lineRows.map((l) => {
    const mine1 = l.team_1_registration_id === regId || l.team_1_partner_registration_id === regId
    const mySide: 1 | 2 = mine1 ? 1 : 2
    const oppRegs = (mine1 ? [l.team_2_registration_id, l.team_2_partner_registration_id] : [l.team_1_registration_id, l.team_1_partner_registration_id]).filter(Boolean)
    return {
      lineId: l.id,
      matchupId: l.parent_fixture_id,
      lineLabel: `Line ${l.match_number ?? ''}`.trim(),
      oppLabel: oppRegs.map((r: string) => nameById.get(r) ?? 'Player').join(' / ') || 'Opponent',
      mySide,
      myScore: mine1 ? (l.team_1_score ?? null) : (l.team_2_score ?? null),
      oppScore: mine1 ? (l.team_2_score ?? null) : (l.team_1_score ?? null),
    }
  })
}
