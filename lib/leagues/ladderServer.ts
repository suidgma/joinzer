// Server-side helpers for Ladder League reads. Ladder tables are RLS deny-all, so
// everything goes through the service-role client. Shared by the roster ranking
// editor, the run hub, and the standings view so the entrant-fold + ordering rule
// lives in exactly one place.

import { createClient as createAdmin } from '@supabase/supabase-js'
import { isDoublesFormat } from '@/lib/taxonomy/formats'
import { dedupeRegistrationsToTeams } from '@/lib/tournament/teams'
import { computeFixtureStandings } from '@/lib/leagues/fixtureStandings'
import type { BoxAttendee } from '@/app/(app)/leagues/[id]/attendance/BoxAttendanceManager'
import {
  generateInitialRanking,
  boundedMovement,
  reintegrateRanking,
  type InitialRankingMethod,
  type LadderEntrant,
} from '@/lib/leagues/ladder'

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

export type LadderChange = {
  regId: string
  name: string
  before: number
  after: number
  delta: number
  wins: number
  losses: number
  pf: number
  pa: number
}

// Compute the proposed ladder update for a session (used for both the run-hub
// preview and the finalize write). Participants (entrants who played or byed) move
// toward the night's win-% order, capped at max_move; everyone else holds rank.
export async function computeLadderUpdate(
  admin: ReturnType<typeof ladderAdmin>,
  leagueId: string,
  periodId: string,
  format: string | null,
  settings: Record<string, unknown> | null,
) {
  const { orderedIds: currentRanking, nameOf, byRegId } = await readLadderState(admin, leagueId, format, settings)

  const { data: fxRaw } = await admin
    .from('league_fixtures')
    .select('id, period_id, box_id, round_number, court_number, match_stage, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, winner_registration_id, status')
    .eq('period_id', periodId)
  const fx = (fxRaw ?? []) as any[]
  const roundFx = fx.filter((f) => f.match_stage === 'ladder_round')
  const byeFx = fx.filter((f) => f.match_stage === 'ladder_bye')

  // Participants = every entrant who appeared on a court or took a bye.
  const present = new Set<string>()
  for (const f of roundFx) {
    if (f.team_1_registration_id) present.add(f.team_1_registration_id)
    if (f.team_2_registration_id) present.add(f.team_2_registration_id)
  }
  for (const f of byeFx) if (f.team_1_registration_id) present.add(f.team_1_registration_id)

  const regsForStandings = [...present].map((id) => ({
    id,
    status: 'registered',
    partner_registration_id: byRegId.get(id)?.partner_registration_id ?? null,
  }))
  const standings = computeFixtureStandings(roundFx, regsForStandings as any, { periodId }, nameOf)
  const stat = new Map(standings.map((s) => [s.regId, s]))
  const scoreOf = (id: string): number => {
    const s = stat.get(id)
    if (!s) return 0
    const games = s.wins + s.losses
    const winPct = games > 0 ? s.wins / games : 0
    return winPct * 100000 + (s.pf - s.pa) // higher = better night
  }

  const maxMove = Number(settings?.max_move ?? 3) || 3
  const presentOrder = currentRanking.filter((id) => present.has(id))
  const newPresentOrder = boundedMovement(presentOrder, scoreOf, maxMove)
  const newRanking = reintegrateRanking(currentRanking, present, newPresentOrder)

  const posBefore = new Map(currentRanking.map((id, i) => [id, i + 1]))
  const posAfter = new Map(newRanking.map((id, i) => [id, i + 1]))
  const changes: LadderChange[] = [...present]
    .map((id) => {
      const s = stat.get(id)
      const before = posBefore.get(id) ?? 0
      const after = posAfter.get(id) ?? 0
      return { regId: id, name: nameOf(id), before, after, delta: before - after, wins: s?.wins ?? 0, losses: s?.losses ?? 0, pf: s?.pf ?? 0, pa: s?.pa ?? 0 }
    })
    .sort((a, b) => a.after - b.after)

  const roundsPlayed = roundFx.length ? Math.max(...roundFx.map((f) => f.round_number ?? 0)) : 0
  const unscored = roundFx.filter((f) => f.status !== 'completed').length

  return { currentRanking, newRanking, present, changes, nameOf, byRegId, posBefore, posAfter, roundsPlayed, unscored }
}

// Build the attendance grid rows + sub pool for a ladder session and a sub-aware
// match-name resolver for the court fixtures. Mirrors the box run hub so the
// shared AttendanceGrid / BoxAttendanceManager + sub routes are reused as-is.
export async function buildLadderAttendance(
  admin: ReturnType<typeof ladderAdmin>,
  leagueId: string,
  periodId: string,
  entrantIds: string[],
  byRegId: Map<string, any>,
  nameOf: (regId: string | null) => string,
  doubles: boolean,
) {
  const entrantSet = new Set(entrantIds)
  const { data: attRaw } = await admin
    .from('league_attendance')
    .select('id, registration_id, user_id, guest_name, status, subbing_for_registration_id')
    .eq('period_id', periodId)
  const attendance = (attRaw ?? []) as any[]
  const attByReg = new Map<string, any>()
  for (const a of attendance) if (a.registration_id) attByReg.set(a.registration_id, a)

  // Map each player's registration → their team's entrant (canonical) registration.
  const teamRegOf = new Map<string, string>()
  for (const id of entrantIds) {
    teamRegOf.set(id, id)
    const partnerRid = byRegId.get(id)?.partner_registration_id
    if (partnerRid) teamRegOf.set(partnerRid, id)
  }
  const coveredRegs = new Set(attendance.filter((a) => a.status === 'has_sub' && a.registration_id && entrantSet.has(a.registration_id)).map((a) => a.registration_id))

  const subUserIds = [...new Set(attendance.map((a) => a.user_id).filter(Boolean))] as string[]
  const { data: subProfiles } = subUserIds.length
    ? await admin.from('profiles').select('id, name').in('id', subUserIds)
    : { data: [] as any[] }
  const nameByUserId = new Map((subProfiles ?? []).map((p: any) => [p.id, p.name]))
  const firstNm = (n?: string | null) => (n ? n.trim().split(/\s+/)[0] : '')

  const attendees: BoxAttendee[] = []
  for (const id of entrantIds) {
    const att = attByReg.get(id)
    attendees.push({
      rowId: id,
      attendanceId: att?.id ?? null,
      registrationId: id,
      partnerRegistrationId: doubles ? (byRegId.get(id)?.partner_registration_id ?? null) : null,
      kind: 'roster',
      displayName: nameOf(id),
      status: att?.status ?? 'not_present',
      subbingForRegistrationId: null,
    })
  }
  for (const a of attendance) {
    if (a.registration_id && entrantSet.has(a.registration_id)) continue
    const isGuest = !a.registration_id && !a.user_id && !!a.guest_name
    const slotReg = a.subbing_for_registration_id
    const teamReg = slotReg ? teamRegOf.get(slotReg) : undefined
    attendees.push({
      rowId: a.id,
      attendanceId: a.id,
      registrationId: a.registration_id ?? null,
      partnerRegistrationId: null,
      kind: isGuest ? 'guest' : 'sub',
      displayName: a.registration_id ? nameOf(a.registration_id) : (a.user_id ? (nameByUserId.get(a.user_id) ?? 'Sub') : (a.guest_name ?? 'Guest')),
      status: a.status,
      subbingForRegistrationId: teamReg && coveredRegs.has(teamReg) ? teamReg : null,
    })
  }

  // Sub pool = any profile not already an entrant or an attendee this session.
  const entrantUserIds = entrantIds.map((id) => byRegId.get(id)?.user_id).filter(Boolean)
  const excludeUserIds = [...new Set([...entrantUserIds, ...subUserIds])] as string[]
  const poolQuery = admin.from('profiles').select('id, name').order('name')
  const { data: pool } = excludeUserIds.length > 0 ? await poolQuery.not('id', 'in', `(${excludeUserIds.join(',')})`) : await poolQuery
  const availableSubs = (pool ?? []).map((p: any) => ({ userId: p.id as string, name: p.name ?? 'Player' }))

  // Sub-aware court names: a covered slot shows the sub; a doubles team composes
  // each half (sub or present partner).
  const subNameBySlotReg = new Map<string, string>()
  for (const a of attendance) {
    const slotReg = a.subbing_for_registration_id
    if (!slotReg) continue
    const teamReg = teamRegOf.get(slotReg)
    if (!teamReg || !coveredRegs.has(teamReg)) continue
    const nm = a.registration_id ? nameOf(a.registration_id) : (a.user_id ? (nameByUserId.get(a.user_id) ?? 'Sub') : (a.guest_name ?? 'Guest'))
    subNameBySlotReg.set(slotReg, firstNm(nm) || nm)
  }
  const matchName = (regId: string | null): string => {
    if (!regId) return nameOf(regId)
    if (!doubles) return subNameBySlotReg.get(regId) ?? nameOf(regId)
    const slotName = (rid: string | null): string => (rid ? (subNameBySlotReg.get(rid) ?? (firstNm(byRegId.get(rid)?.profile?.name) || '')) : '')
    const partnerRegId = byRegId.get(regId)?.partner_registration_id ?? null
    const a = slotName(regId)
    const b = partnerRegId ? slotName(partnerRegId) : ''
    return b ? `${a}/${b}` : a || nameOf(regId)
  }

  return { attendees, availableSubs, matchName }
}
