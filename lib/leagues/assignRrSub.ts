import type { SupabaseClient } from '@supabase/supabase-js'

export type AssignRrSubResult =
  | { ok: true; subPlayer: Record<string, unknown> }
  | { ok: false; error: string; status: number }

// Places a substitute into a round-robin session: finds-or-creates the sub's
// league_session_players row and links it to the absent roster player. Optionally
// marks the covered roster player 'has_sub'. Shared by the organizer assign-sub
// route and the player self-sub flow so the placement lives in exactly one place.
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
  // The covered player must belong to this session.
  const { data: absentPlayer } = await db
    .from('league_session_players')
    .select('id')
    .eq('id', absentPlayerId)
    .eq('session_id', sessionId)
    .single()
  if (!absentPlayer) return { ok: false, error: 'Absent player not found in this session', status: 404 }

  const { data: subProfile } = await db
    .from('profiles')
    .select('id, name, joinzer_rating')
    .eq('id', subUserId)
    .single()
  if (!subProfile) return { ok: false, error: 'Sub player profile not found', status: 404 }

  // Find or create the sub's session row.
  const { data: existingRow } = await db
    .from('league_session_players')
    .select('id')
    .eq('session_id', sessionId)
    .eq('user_id', subUserId)
    .maybeSingle()

  let subPlayer: Record<string, unknown>
  if (existingRow) {
    const { data, error } = await db
      .from('league_session_players')
      .update({ player_type: 'sub', actual_status: 'present', sub_for_session_player_id: absentPlayerId })
      .eq('id', existingRow.id)
      .select()
      .single()
    if (error) return { ok: false, error: error.message, status: 500 }
    subPlayer = data
  } else {
    const { data, error } = await db
      .from('league_session_players')
      .insert({
        session_id: sessionId,
        user_id: subUserId,
        display_name: subProfile.name,
        player_type: 'sub',
        expected_status: 'expected',
        actual_status: 'present',
        joinzer_rating: subProfile.joinzer_rating ?? 1000,
        sub_for_session_player_id: absentPlayerId,
      })
      .select()
      .single()
    if (error) return { ok: false, error: error.message, status: 500 }
    subPlayer = data
  }

  // The player self-sub wants the covered player flipped to 'has_sub' atomically;
  // the organizer flow leaves that to the attendance grid, so it's opt-in.
  if (markCoveredHasSub) {
    await db
      .from('league_session_players')
      .update({ actual_status: 'has_sub' })
      .eq('id', absentPlayerId)
  }

  return { ok: true, subPlayer }
}
