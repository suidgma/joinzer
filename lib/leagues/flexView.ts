// Shared read model for the Flex surfaces (organizer hub + player match list). Loads the
// round-robin fixtures with display names, per-side user sets (to decide who reported and
// which side the viewer is on), status, and roll-up counts. Service-role reads.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isDoublesFormat } from '@/lib/taxonomy/formats'

export type FlexSide = 'team_1' | 'team_2'
export type FlexMatchView = {
  id: string
  round: number | null
  side1Name: string
  side2Name: string
  status: string
  team1Score: number | null
  team2Score: number | null
  reporterSide: FlexSide | null // which side entered the pending report
  winner1: boolean | null // side 1 won (completed only)
  viewerSide: FlexSide | null // the viewing player's side, if any
}
export type FlexCounts = { total: number; completed: number; pending: number; disputed: number; scheduled: number }
export type FlexMatchesResult = { matches: FlexMatchView[]; counts: FlexCounts; entrantCount: number }

const firstName = (n?: string | null) => (n ? n.trim().split(/\s+/)[0] : '')

export async function loadFlexMatches(
  db: SupabaseClient,
  leagueId: string,
  format: string | null,
  viewerUserId?: string | null,
): Promise<FlexMatchesResult> {
  const doubles = isDoublesFormat(format)
  const { data: regsRaw } = await db
    .from('league_registrations')
    .select('id, user_id, status, partner_registration_id, profile:profiles!user_id(name)')
    .eq('league_id', leagueId).neq('status', 'cancelled')
  const regs = (regsRaw ?? []) as any[]
  const byId = new Map<string, any>(regs.map((r) => [r.id, r]))

  const nameOf = (regId: string | null): string => {
    if (!regId) return 'Player'
    const r = byId.get(regId)
    if (!r) return 'Player'
    const a = firstName(r.profile?.name)
    if (!doubles) return a || 'Player'
    const partner = r.partner_registration_id ? byId.get(r.partner_registration_id) : null
    const b = partner ? firstName(partner.profile?.name) : ''
    return b ? `${a}/${b}` : a || 'Team'
  }
  // The user_ids that make up an entrant (the reg's user + its partner, either cross-link).
  const usersOfEntrant = (regId: string | null): Set<string> => {
    const out = new Set<string>()
    if (!regId) return out
    const reg = byId.get(regId)
    if (reg?.user_id) out.add(reg.user_id)
    if (reg?.partner_registration_id) {
      const p = byId.get(reg.partner_registration_id)
      if (p?.user_id) out.add(p.user_id)
    }
    for (const r of regs) if (r.partner_registration_id === regId && r.user_id) out.add(r.user_id)
    return out
  }

  const entrantCount = (() => {
    const seen = new Set<string>()
    let n = 0
    for (const r of regs) {
      if (r.status !== 'registered') continue
      const canonical = r.partner_registration_id ? (r.id < r.partner_registration_id ? r.id : r.partner_registration_id) : r.id
      if (seen.has(canonical)) continue
      seen.add(canonical); n++
    }
    return n
  })()

  const { data: fxRaw } = await db
    .from('league_fixtures')
    .select('id, round_number, match_number, status, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, reported_by, winner_registration_id')
    .eq('league_id', leagueId).eq('match_stage', 'round_robin')
    .order('round_number', { ascending: true }).order('match_number', { ascending: true })
  const fixtures = (fxRaw ?? []) as any[]

  const matches: FlexMatchView[] = fixtures.map((f) => {
    const side1Users = usersOfEntrant(f.team_1_registration_id)
    const side2Users = usersOfEntrant(f.team_2_registration_id)
    const sideOf = (userId: string | null | undefined): FlexSide | null =>
      !userId ? null : side1Users.has(userId) ? 'team_1' : side2Users.has(userId) ? 'team_2' : null
    return {
      id: f.id,
      round: f.round_number ?? null,
      side1Name: nameOf(f.team_1_registration_id),
      side2Name: nameOf(f.team_2_registration_id),
      status: f.status,
      team1Score: f.team_1_score ?? null,
      team2Score: f.team_2_score ?? null,
      reporterSide: sideOf(f.reported_by),
      winner1: f.status === 'completed' && f.winner_registration_id != null ? f.winner_registration_id === f.team_1_registration_id : null,
      viewerSide: sideOf(viewerUserId),
    }
  })

  const counts: FlexCounts = {
    total: matches.length,
    completed: matches.filter((m) => m.status === 'completed').length,
    pending: matches.filter((m) => m.status === 'in_progress').length,
    disputed: matches.filter((m) => m.status === 'disputed').length,
    scheduled: matches.filter((m) => m.status === 'scheduled').length,
  }
  return { matches, counts, entrantCount }
}
