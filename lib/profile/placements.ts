// Pure placement derivation for a completed tournament division → champion (1st),
// finalist (2nd), podium (3rd). Reuses the tested standings core for round-robin; reads
// bracket topology for elimination. Returns [] when the division isn't finished, so a
// placement is only ever a *final* result. Tournaments only — leagues have no season-end
// champion concept yet. See docs/phases/player-profile-phase1.md (Phase 3).

import { computeStandings, type StandingsMatchInput, type StandingsRegInput } from '../tournament/standings'

export type PlacementMatch = StandingsMatchInput & { match_number?: number | null }
export type PlacementReg = StandingsRegInput
export type Placement = { registrationId: string; place: 1 | 2 | 3 }

const loserOf = (m: PlacementMatch): string | null =>
  m.winner_registration_id === m.team_1_registration_id ? m.team_2_registration_id
    : m.winner_registration_id === m.team_2_registration_id ? m.team_1_registration_id
      : null

// Semifinal losers (single-elim / playoff bracket): the completed matches one round below
// the final. Byes (no loser) are skipped. Both share 3rd.
function semifinalThirds(stageMatches: PlacementMatch[], finalRound: number): string[] {
  return stageMatches
    .filter((m) => (m.round_number ?? 0) === finalRound - 1 && m.status === 'completed')
    .map(loserOf)
    .filter((x): x is string => !!x)
}

export function computePlacements(bracketType: string, matches: PlacementMatch[], regs: PlacementReg[]): Placement[] {
  // ── Round robin: all matches complete → standings top 3. ──
  if (bracketType === 'round_robin') {
    const rr = matches.filter((m) => m.match_stage === 'round_robin')
    if (rr.length === 0 || rr.some((m) => m.status !== 'completed')) return []
    return computeStandings(rr, regs)
      .slice(0, 3)
      .map((s, i) => ({ registrationId: s.regId, place: (i + 1) as 1 | 2 | 3 }))
  }

  // ── Double elimination: reset-aware. team_1 of the championship = WB champ (0 losses),
  //    team_2 = LB champ (1 loss). A reset (round 2) is only decisive if the LB champ won
  //    round 1; otherwise round 1 crowns the WB champ. ──
  if (bracketType === 'double_elimination') {
    const champ = matches.filter((m) => m.match_stage === 'championship')
    const r1 = champ.find((m) => (m.round_number ?? 0) === 1 && m.status === 'completed')
    if (!r1?.winner_registration_id) return []
    let champion: string
    let finalist: string | null
    if (r1.winner_registration_id === r1.team_1_registration_id) {
      champion = r1.team_1_registration_id!
      finalist = r1.team_2_registration_id
    } else {
      const r2 = champ.find((m) => (m.round_number ?? 0) === 2 && m.status === 'completed')
      if (!r2?.winner_registration_id) return [] // reset pending → not finished
      champion = r2.winner_registration_id
      finalist = loserOf(r2)
    }
    const places: Placement[] = [{ registrationId: champion, place: 1 }]
    if (finalist) places.push({ registrationId: finalist, place: 2 })
    const lb = matches.filter((m) => m.match_stage === 'losers_bracket')
    if (lb.length) {
      const lbFinalRound = Math.max(...lb.map((m) => m.round_number ?? 0))
      const lbFinal = lb.find((m) => (m.round_number ?? 0) === lbFinalRound && m.status === 'completed')
      const third = lbFinal ? loserOf(lbFinal) : null
      if (third) places.push({ registrationId: third, place: 3 })
    }
    return places
  }

  // ── Single elim + pool→playoffs bracket: final = the top-round match of the elim stage. ──
  const stage = bracketType === 'single_elimination'
    ? 'single_elimination'
    : bracketType === 'pool_play_playoffs'
      ? (matches.some((m) => m.match_stage === 'championship') ? 'championship' : 'playoffs')
      : null
  if (!stage) return []

  const stageMatches = matches.filter((m) => m.match_stage === stage)
  if (stageMatches.length === 0) return []
  const finalRound = Math.max(...stageMatches.map((m) => m.round_number ?? 0))
  const finalMatch = stageMatches
    .filter((m) => (m.round_number ?? 0) === finalRound)
    .sort((a, b) => (a.match_number ?? 0) - (b.match_number ?? 0))[0]
  if (!finalMatch || finalMatch.status !== 'completed' || !finalMatch.winner_registration_id) return []

  const champion = finalMatch.winner_registration_id
  const finalist = loserOf(finalMatch)
  const places: Placement[] = [{ registrationId: champion, place: 1 }]
  if (finalist) places.push({ registrationId: finalist, place: 2 })
  for (const third of semifinalThirds(stageMatches, finalRound)) places.push({ registrationId: third, place: 3 })
  return places
}
