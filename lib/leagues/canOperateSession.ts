import type { SupabaseClient } from '@supabase/supabase-js'

// Who may RUN a round-robin league's live session — i.e. drive attendance, generate the next
// round, lock/complete rounds, assign subs, add a guest, end the day.
//
//   • the league owner (leagues.created_by)              — always
//   • a co-admin (league_registrations.is_co_admin)      — always (season-long delegate)
//   • the effective session host, when the league is     — player-run leagues only
//     player-run (leagues.self_run):
//       session.host_user_id ?? league.season_host_user_id
//
// Scoring is NOT gated here — self-run leagues distribute scoring to players via
// allow_player_scores, so this covers only the operator actions. Pass a service-role client
// (the run-session tables are touched server-side); this function is the authorization boundary.
export async function canOperateSession(
  db: SupabaseClient,
  sessionId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false

  const { data: session } = await db
    .from('league_sessions')
    .select('league_id, host_user_id')
    .eq('id', sessionId)
    .single()
  if (!session) return false
  const leagueId = (session as { league_id: string }).league_id

  const { data: league } = await db
    .from('leagues')
    .select('created_by, self_run, season_host_user_id')
    .eq('id', leagueId)
    .single()
  if (!league) return false
  const l = league as { created_by: string; self_run: boolean | null; season_host_user_id: string | null }

  if (l.created_by === userId) return true

  const { data: reg } = await db
    .from('league_registrations')
    .select('is_co_admin')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .maybeSingle()
  if ((reg as { is_co_admin?: boolean } | null)?.is_co_admin) return true

  if (l.self_run) {
    const effectiveHost =
      (session as { host_user_id: string | null }).host_user_id ?? l.season_host_user_id
    if (effectiveHost && effectiveHost === userId) return true
  }

  return false
}

// Round-scoped convenience: resolve the round's session, then delegate. Returns false for an
// unknown round. Used by the league-rounds routes (lock/complete, manual match edit).
export async function canOperateRound(
  db: SupabaseClient,
  roundId: string,
  userId: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false
  const { data: round } = await db
    .from('league_rounds')
    .select('session_id')
    .eq('id', roundId)
    .single()
  if (!round) return false
  return canOperateSession(db, (round as { session_id: string }).session_id, userId)
}
