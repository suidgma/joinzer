import type { SupabaseClient } from '@supabase/supabase-js'

export type AssignRrSubResult =
  | { ok: true; subPlayer: Record<string, unknown> }
  | { ok: false; error: string; status: number }

// Places a substitute into a round-robin session by delegating to the shared SQL placement
// primitive `place_league_sub_rr` (migration 20260716000004) — the SINGLE source of truth for RR
// substitute linkage. The same primitive backs the atomic open-pool acceptance RPC
// (accept_sub_request), so organizer manual-assign, player self-sub, and open-pool accept can never
// drift. Finds-or-creates the sub's league_session_players row, links it to the absent roster
// player, and optionally flips the covered row to 'has_sub'. leagues.sub_credit_cap is unaffected.
export async function assignRrSub(
  db: SupabaseClient,
  {
    sessionId,
    absentPlayerId,
    subUserId,
    markCoveredHasSub = false,
  }: {
    sessionId: string
    absentPlayerId: string
    subUserId: string
    markCoveredHasSub?: boolean
  }
): Promise<AssignRrSubResult> {
  const { data, error } = await db.rpc('place_league_sub_rr', {
    p_session_id: sessionId,
    p_covered_session_player_id: absentPlayerId,
    p_sub_user_id: subUserId,
    p_mark_covered_has_sub: markCoveredHasSub,
  })

  if (error) {
    // The primitive raises machine-code messages; map the two "not found" cases to 404 to preserve
    // the previous behavior, everything else to 500.
    const code = (error.message ?? '').trim()
    if (code === 'covered_not_in_session') return { ok: false, error: 'Absent player not found in this session', status: 404 }
    if (code === 'sub_profile_not_found') return { ok: false, error: 'Sub player profile not found', status: 404 }
    return { ok: false, error: error.message ?? 'Could not place the sub', status: 500 }
  }

  return { ok: true, subPlayer: (data ?? {}) as Record<string, unknown> }
}
