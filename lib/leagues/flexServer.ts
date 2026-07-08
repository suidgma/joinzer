// Server helpers for Flex League routes. league_fixtures is RLS deny-all, so reads/writes
// go through the service role. Organizer gating for setup (generate/resolve); the
// report/confirm/dispute routes additionally resolve the acting user to their entrant side.

import { createClient as createAdmin, type SupabaseClient } from '@supabase/supabase-js'
import type { EntrantSides } from '@/lib/leagues/flexFixture'

export function flexAdmin(): SupabaseClient {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export type OrgGate = { ok: true } | { ok: false; status: number; error: string }

// League exists, is Flex, and the user is the creator or a co-admin.
export async function assertFlexLeagueOrganizer(db: SupabaseClient, leagueId: string, userId: string): Promise<OrgGate> {
  const { data: league } = await db.from('leagues').select('created_by, format_kind').eq('id', leagueId).single()
  if (!league) return { ok: false, status: 404, error: 'League not found' }
  if ((league as any).format_kind !== 'flex') return { ok: false, status: 400, error: 'Not a Flex League' }
  let allowed = (league as any).created_by === userId
  if (!allowed) {
    const { data: myReg } = await db
      .from('league_registrations').select('is_co_admin').eq('league_id', leagueId).eq('user_id', userId).maybeSingle()
    allowed = (myReg as any)?.is_co_admin === true
  }
  if (!allowed) return { ok: false, status: 403, error: 'Forbidden' }
  return { ok: true }
}

export async function isFlexOrganizer(db: SupabaseClient, leagueId: string, userId: string): Promise<boolean> {
  const gate = await assertFlexLeagueOrganizer(db, leagueId, userId)
  return gate.ok
}

export type FlexFixtureRow = {
  id: string
  status: string
  team_1_registration_id: string | null
  team_2_registration_id: string | null
  team_1_score: number | null
  team_2_score: number | null
  reported_by: string | null
  confirmed_by: string | null
}
export type FixtureContext =
  | { ok: true; fixture: FlexFixtureRow; sides: EntrantSides; isOrganizer: boolean }
  | { ok: false; status: number; error: string }

// Load everything a report/confirm/dispute/resolve route needs: the fixture, the user
// sets per side (for actor checks), and whether the caller is the organizer. Any
// authenticated user may call this — the pure state machine enforces who can do what.
export async function loadFlexFixtureContext(db: SupabaseClient, leagueId: string, fixtureId: string, userId: string): Promise<FixtureContext> {
  const { data: league } = await db.from('leagues').select('created_by, format_kind').eq('id', leagueId).single()
  if (!league) return { ok: false, status: 404, error: 'League not found' }
  if ((league as any).format_kind !== 'flex') return { ok: false, status: 400, error: 'Not a Flex League' }

  const { data: fixture } = await db.from('league_fixtures')
    .select('id, status, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, reported_by, confirmed_by')
    .eq('id', fixtureId).eq('league_id', leagueId).eq('match_stage', 'round_robin').maybeSingle()
  if (!fixture) return { ok: false, status: 404, error: 'Match not found' }

  const sides = await entrantSidesForFixture(db, leagueId, (fixture as any).team_1_registration_id, (fixture as any).team_2_registration_id)
  let isOrganizer = (league as any).created_by === userId
  if (!isOrganizer) {
    const { data: myReg } = await db.from('league_registrations').select('is_co_admin').eq('league_id', leagueId).eq('user_id', userId).maybeSingle()
    isOrganizer = (myReg as any)?.is_co_admin === true
  }
  return { ok: true, fixture: fixture as FlexFixtureRow, sides, isOrganizer }
}

// The user_ids on each side of a fixture — a singles entrant is its own user; a
// fixed-doubles entrant is the canonical registration + its partner (both users).
// Used by report/confirm/dispute to decide who may act. Maps registration_id → user_id
// across the fixture's two entrants (and each entrant's partner, if any).
export async function entrantSidesForFixture(
  db: SupabaseClient,
  leagueId: string,
  side1RegId: string | null,
  side2RegId: string | null,
): Promise<EntrantSides> {
  const { data: regs } = await db
    .from('league_registrations')
    .select('id, user_id, partner_registration_id')
    .eq('league_id', leagueId)
  const rows = (regs ?? []) as { id: string; user_id: string; partner_registration_id: string | null }[]
  const byId = new Map(rows.map((r) => [r.id, r]))

  const usersFor = (regId: string | null): Set<string> => {
    const out = new Set<string>()
    if (!regId) return out
    const reg = byId.get(regId)
    if (reg?.user_id) out.add(reg.user_id)
    // The canonical entrant may have a partner on either cross-link direction.
    if (reg?.partner_registration_id) {
      const p = byId.get(reg.partner_registration_id)
      if (p?.user_id) out.add(p.user_id)
    }
    for (const r of rows) {
      if (r.partner_registration_id === regId && r.user_id) out.add(r.user_id)
    }
    return out
  }

  return { team_1: usersFor(side1RegId), team_2: usersFor(side2RegId) }
}
