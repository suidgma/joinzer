// Writes the player_stats cache from already-extracted GameRecords (called by the nightly
// recompute, sharing its single extract). Full replace — idempotent, like player_ratings.
// One row per player with ≥1 competitive game; zero-match players fall back to
// compute-on-read in the profile loader. See docs/phases/player-profile-phase1.md §7 (Phase 2).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { GameRecord } from '../rating/types'
import { computePlayerStats } from '../rating/stats'

export async function recomputePlayerStats(admin: SupabaseClient, games: GameRecord[], asOf: string): Promise<number> {
  const players = new Set<string>()
  for (const g of games) {
    for (const u of g.sideA) players.add(u)
    for (const u of g.sideB) players.add(u)
  }

  const rows = [...players].map((pid) => ({
    player_id: pid,
    stats: computePlayerStats(games, pid),
    updated_at: asOf,
  }))

  await admin.from('player_stats').delete().not('player_id', 'is', null)
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('player_stats').insert(rows.slice(i, i + 500))
    if (error) throw new Error(`player_stats insert: ${error.message}`)
  }
  return rows.length
}
