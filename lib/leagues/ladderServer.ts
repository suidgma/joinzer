// Server-side helpers for Ladder League reads. Ladder tables are RLS deny-all, so
// everything goes through the service-role client. Shared by the roster ranking
// editor, the run hub, and the standings view so the entrant-fold + ordering rule
// lives in exactly one place.

import { createClient as createAdmin } from '@supabase/supabase-js'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import { dedupeRegistrationsToTeams } from '@/lib/tournament/teams'
import { generateInitialRanking, type InitialRankingMethod, type LadderEntrant } from '@/lib/leagues/ladder'

export function ladderAdmin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export type LadderEntrantView = { registrationId: string; name: string; rating: number | null }

const firstName = (n?: string | null) => (n ? n.trim().split(/\s+/)[0] : '')

// Read the league's ladder state: entrants folded to one per team, ordered by
// current ladder position, with any entrant lacking a stored position appended at
// the bottom via the league's initial-ranking method. Returns display helpers too.
export async function readLadderState(
  admin: ReturnType<typeof ladderAdmin>,
  leagueId: string,
  format: string | null,
  settings: Record<string, unknown> | null,
) {
  const doubles = isDoublesFormat(format)

  const { data: regsRaw } = await admin
    .from('league_registrations')
    .select('id, user_id, status, payment_status, registered_at, partner_registration_id, profile:profiles!user_id(name, dupr_rating, estimated_rating)')
    .eq('league_id', leagueId)
    .neq('status', 'cancelled')
  const regs = (regsRaw ?? []) as any[]
  const byRegId = new Map<string, any>(regs.map((r) => [r.id, r]))

  const nameOf = (regId: string | null): string => {
    if (!regId) return 'Player'
    const r = byRegId.get(regId)
    if (!r) return 'Player'
    const a = firstName(r.profile?.name)
    if (!doubles) return a || 'Player'
    const partner = r.partner_registration_id ? byRegId.get(r.partner_registration_id) : null
    const b = partner ? firstName(partner.profile?.name) : ''
    return b ? `${a}/${b}` : (a || 'Team')
  }
  const ratingOf = (r: any): number | null => r?.profile?.dupr_rating ?? r?.profile?.estimated_rating ?? null
  const teamRating = (regId: string): number | null => {
    const r = byRegId.get(regId)
    const r1 = ratingOf(r)
    if (!doubles) return r1
    const partner = r?.partner_registration_id ? byRegId.get(r.partner_registration_id) : null
    const r2 = partner ? ratingOf(partner) : null
    return r1 != null && r2 != null ? (r1 + r2) / 2 : r1 ?? r2
  }

  // Entrants = settled registrations, folded to one canonical id per doubles team.
  const settled = regs.filter(
    (r) => r.status === 'registered' && (r.payment_status == null || ['paid', 'waived', 'comped', 'free'].includes(r.payment_status)),
  )
  const entrantIds = doubles ? dedupeRegistrationsToTeams(settled) : settled.map((r) => r.id)
  const entrantSet = new Set(entrantIds)

  const { data: posRows } = await admin
    .from('ladder_positions')
    .select('registration_id, position')
    .eq('league_id', leagueId)
    .order('position', { ascending: true })
  const posByReg = new Map<string, number>((posRows ?? []).map((p: any) => [p.registration_id, p.position]))

  const ranked = (posRows ?? []).map((p: any) => p.registration_id).filter((id: string) => entrantSet.has(id))
  const rankedSet = new Set(ranked)
  const unranked = entrantIds.filter((id) => !rankedSet.has(id))
  const method = ((settings?.initial_ranking as InitialRankingMethod) ?? 'rating') as InitialRankingMethod
  const unrankedEntrants: LadderEntrant[] = unranked.map((id) => ({
    registrationId: id,
    rating: teamRating(id),
    registeredAt: byRegId.get(id)?.registered_at ?? null,
  }))
  const orderedIds = [...ranked, ...generateInitialRanking(unrankedEntrants, method)]

  const entrants: LadderEntrantView[] = orderedIds.map((id) => ({ registrationId: id, name: nameOf(id), rating: teamRating(id) }))

  return { doubles, byRegId, nameOf, teamRating, orderedIds, entrants, posByReg, entrantSet }
}
