import type { SupabaseClient } from '@supabase/supabase-js'
import type { MatchRow } from './bracketBuilder'

// One match-row update produced while advancing BYE winners. All values are
// strings (registration ids or a status), so a single record type covers the
// computed `team_*`/`winner`/`status` keys without per-key typing friction.
export type ByeUpdate = { matchId: string; set: Record<string, string> }

// Pure: given a freshly-built single- or double-elimination bracket (rows with
// DB ids), compute the updates that advance round-1 BYE winners into round 2 and
// resolve induced round-2 byes into round 3.
//
// Why this is needed: a round-1 bye is auto-completed at build time (no score is
// ever entered), so the score-entry advancement cascade never fires for it. If
// the bye winner isn't advanced here, its next-round slot stays empty and the
// match auto-resolves as a walkover — silently dropping the player who earned the
// bye. Mirrors the cascade the per-division generate route has always run inline.
//
// `wbStage` is the winners-bracket stage name: 'single_elimination' for single
// elim, 'winners_bracket' for double elim.
export function computeByeAdvancements(matches: MatchRow[], wbStage: string): ByeUpdate[] {
  const updates: ByeUpdate[] = []
  const byNum = (a: MatchRow, b: MatchRow) => a.match_number - b.match_number
  const inRound = (n: number) =>
    matches.filter(m => m.match_stage === wbStage && (m.round_number ?? 1) === n).sort(byNum)

  const r1 = inRound(1)
  const r2 = inRound(2).map(m => ({ ...m }))   // copies — mutated as Step 1 fills slots
  const r3 = inRound(3).map(m => ({ ...m }))

  // Step 1 — push each round-1 BYE winner into its round-2 slot. Match i feeds
  // round-2 match ⌊i/2⌋, as team_1 (even i) or team_2 (odd i).
  for (let i = 0; i < r1.length; i++) {
    const m = r1[i]
    if (m.status !== 'completed' || !m.winner_registration_id) continue
    const r2m = r2[Math.floor(i / 2)]
    if (!r2m) continue
    const field = i % 2 === 0 ? 'team_1_registration_id' : 'team_2_registration_id'
    updates.push({ matchId: r2m.id, set: { [field]: m.winner_registration_id } })
    r2m[field] = m.winner_registration_id
  }

  // Step 2 — a round-2 match with exactly one filled slot whose OTHER feeder is a
  // phantom (a both-null round-1 match that will never produce a winner) is an
  // induced BYE: auto-complete it and advance the lone player into round 3.
  for (let j = 0; j < r2.length; j++) {
    const m = r2[j]
    const t1 = m.team_1_registration_id
    const t2 = m.team_2_registration_id
    if ((!t1 && !t2) || (t1 && t2)) continue       // phantom or real match — leave it
    const emptyIsTeam2 = !!t1 && !t2
    const feeder = r1[j * 2 + (emptyIsTeam2 ? 1 : 0)]
    const feederIsPhantom =
      !feeder || (!feeder.team_1_registration_id && !feeder.team_2_registration_id)
    if (!feederIsPhantom) continue                 // a real match will fill this slot later

    const byeWinner = (t1 ?? t2) as string
    const filledField = emptyIsTeam2 ? 'team_1_registration_id' : 'team_2_registration_id'
    updates.push({
      matchId: m.id,
      set: { [filledField]: byeWinner, winner_registration_id: byeWinner, status: 'completed' },
    })

    const r3m = r3[Math.floor(j / 2)]
    if (r3m) {
      const r3Field = j % 2 === 0 ? 'team_1_registration_id' : 'team_2_registration_id'
      updates.push({ matchId: r3m.id, set: { [r3Field]: byeWinner } })
      r3m[r3Field] = byeWinner
    }
  }

  return updates
}

// Applies computeByeAdvancements to the DB. Returns the number of updates made.
export async function applyByeAdvancements(
  service: SupabaseClient,
  matches: MatchRow[],
  wbStage: string,
): Promise<number> {
  const updates = computeByeAdvancements(matches, wbStage)
  for (const u of updates) {
    await service.from('tournament_matches').update(u.set).eq('id', u.matchId)
  }
  return updates.length
}
