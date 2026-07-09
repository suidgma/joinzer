// Derives tournament placement achievements (champion/finalist/podium) for every completed
// division and persists them per player. Called by the nightly recompute (full replace,
// idempotent). Tournaments only. See docs/phases/player-profile-phase1.md (Phase 3).

import type { SupabaseClient } from '@supabase/supabase-js'
import { computePlacements, type PlacementMatch } from './placements'

type Reg = { id: string; division_id: string | null; user_id: string | null; partner_user_id: string | null; partner_registration_id: string | null; status: string }

export async function recomputeAchievements(admin: SupabaseClient, _asOf: string): Promise<number> {
  const [{ data: divisions }, { data: tournaments }, { data: regsRaw }, { data: matchesRaw }] = await Promise.all([
    admin.from('tournament_divisions').select('id, tournament_id, name, bracket_type'),
    admin.from('tournaments').select('id, name, start_date'),
    admin.from('tournament_registrations').select('id, division_id, user_id, partner_user_id, partner_registration_id, status'),
    admin.from('tournament_matches')
      .select('division_id, match_stage, round_number, match_number, status, team_1_registration_id, team_2_registration_id, team_1_score, team_2_score, winner_registration_id')
      .eq('is_draft', false),
  ])

  const regs = (regsRaw ?? []) as Reg[]
  const regById = new Map(regs.map((r) => [r.id, r]))
  const tourById = new Map((tournaments ?? []).map((t: any) => [t.id, t]))

  const matchesByDiv = new Map<string, PlacementMatch[]>()
  for (const m of (matchesRaw ?? []) as any[]) {
    if (!m.division_id) continue
    if (!matchesByDiv.has(m.division_id)) matchesByDiv.set(m.division_id, [])
    matchesByDiv.get(m.division_id)!.push(m)
  }
  const regsByDiv = new Map<string, { id: string; status: string; partner_registration_id: string | null }[]>()
  for (const r of regs) {
    if (!r.division_id) continue
    if (!regsByDiv.has(r.division_id)) regsByDiv.set(r.division_id, [])
    regsByDiv.get(r.division_id)!.push({ id: r.id, status: r.status, partner_registration_id: r.partner_registration_id })
  }

  // A placement registration → the user_ids who earned it (both partners for doubles).
  const usersOf = (regId: string): string[] => {
    const r = regById.get(regId)
    if (!r) return []
    const out = new Set<string>()
    if (r.user_id) out.add(r.user_id)
    if (r.partner_user_id) out.add(r.partner_user_id)
    if (r.partner_registration_id) {
      const p = regById.get(r.partner_registration_id)
      if (p?.user_id) out.add(p.user_id)
    }
    return [...out]
  }

  type Row = { player_id: string; place: number; tournament_id: string | null; division_id: string; tournament_name: string | null; division_name: string | null; earned_on: string | null }
  const byKey = new Map<string, Row>() // dedupe (player, division), keep the best (lowest) place
  for (const div of (divisions ?? []) as any[]) {
    const placements = computePlacements(div.bracket_type ?? '', matchesByDiv.get(div.id) ?? [], regsByDiv.get(div.id) ?? [])
    if (!placements.length) continue
    const tour = tourById.get(div.tournament_id)
    for (const p of placements) {
      for (const uid of usersOf(p.registrationId)) {
        const key = `${uid}:${div.id}`
        const row: Row = {
          player_id: uid, place: p.place,
          tournament_id: div.tournament_id, division_id: div.id,
          tournament_name: tour?.name ?? null, division_name: div.name ?? null,
          earned_on: tour?.start_date ?? null,
        }
        const existing = byKey.get(key)
        if (!existing || row.place < existing.place) byKey.set(key, row)
      }
    }
  }

  const rows = [...byKey.values()]
  await admin.from('player_achievements').delete().not('player_id', 'is', null)
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('player_achievements').insert(rows.slice(i, i + 500))
    if (error) throw new Error(`player_achievements insert: ${error.message}`)
  }
  return rows.length
}
