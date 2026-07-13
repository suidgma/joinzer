// Server helpers for Team League team/roster management (Phase 1 Step 1). The
// league_teams / league_team_members tables are RLS deny-all, so all reads/writes go
// through the service role. Gating is organizer-only for the MVP (organizer creates +
// assigns rosters). See docs/phases/team-league.md.

import { createClient as createAdmin, type SupabaseClient } from '@supabase/supabase-js'

export function teamAdmin(): SupabaseClient {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export type OrgGate = { ok: true } | { ok: false; status: number; error: string }

// Confirms the league exists, is a Team League, and the user is the creator or a co-admin.
export async function assertTeamLeagueOrganizer(db: SupabaseClient, leagueId: string, userId: string): Promise<OrgGate> {
  const { data: league } = await db.from('leagues').select('created_by, format_kind').eq('id', leagueId).single()
  if (!league) return { ok: false, status: 404, error: 'League not found' }
  if ((league as any).format_kind !== 'team') return { ok: false, status: 400, error: 'Not a Team League' }
  let allowed = (league as any).created_by === userId
  if (!allowed) {
    const { data: myReg } = await db
      .from('league_registrations').select('is_co_admin').eq('league_id', leagueId).eq('user_id', userId).maybeSingle()
    allowed = (myReg as any)?.is_co_admin === true
  }
  if (!allowed) return { ok: false, status: 403, error: 'Forbidden' }
  return { ok: true }
}

// The team ids this user captains in the league (league_teams.captain_registration_id
// points at the captain's registration; match it to any of the user's registrations).
export async function captainTeamIds(db: SupabaseClient, leagueId: string, userId: string): Promise<Set<string>> {
  const { data: myRegs } = await db.from('league_registrations').select('id').eq('league_id', leagueId).eq('user_id', userId)
  const regIds = (myRegs ?? []).map((r: any) => r.id as string)
  if (regIds.length === 0) return new Set()
  const { data: teams } = await db.from('league_teams').select('id').eq('league_id', leagueId).in('captain_registration_id', regIds)
  return new Set((teams ?? []).map((t: any) => t.id as string))
}

// Role for a specific matchup: the league organizer/co-admin runs both sides; a team
// captain runs only their own side.
export async function teamMatchupRole(
  db: SupabaseClient,
  leagueId: string,
  userId: string,
  team1Id: string,
  team2Id: string,
): Promise<{ isOrganizer: boolean; captainSide: 1 | 2 | null }> {
  const org = await assertTeamLeagueOrganizer(db, leagueId, userId)
  if (org.ok) return { isOrganizer: true, captainSide: null }
  const caps = await captainTeamIds(db, leagueId, userId)
  return { isOrganizer: false, captainSide: caps.has(team1Id) ? 1 : caps.has(team2Id) ? 2 : null }
}

// Registration ids already rostered on ANY team in this league (a player belongs to at
// most one team per league).
export async function rosteredRegistrationIds(db: SupabaseClient, leagueId: string): Promise<Set<string>> {
  const { data: teams } = await db.from('league_teams').select('id').eq('league_id', leagueId)
  const teamIds = (teams ?? []).map((t: any) => t.id)
  if (teamIds.length === 0) return new Set()
  const { data: members } = await db.from('league_team_members').select('registration_id').in('team_id', teamIds)
  return new Set((members ?? []).map((m: any) => m.registration_id))
}
