// Recompute all player ratings from scratch and write player_ratings + the profiles cache.
// Server-only (service-role client). Idempotent: a full replace from the source-of-truth
// match history, so "backfill" == "run it once". Not player-visible — no UI reads these
// yet (that's slice 5). See docs/phases/rating-engine-phase2.md §7.

import type { SupabaseClient } from '@supabase/supabase-js'
import { extractAllGameRecords } from './extract'
import { recomputePlayerStats } from '../profile/statsCache'
import { computeRatings, type SeedFn, type PlayerRatingState } from './engine'
import { scoreFromInternal, internalFromScore } from './normalize'
import { provisionalScoreFromSelfReport, scoreToLevel } from './levels'
import { DEFAULT_RD } from './glicko2'

const VERIFIED_DUPR_RD = 150 // tighter starting uncertainty for a verified DUPR seed

export type RecomputeSummary = {
  games: number
  ratings: number
  players: number
  established: number
  rusty: number
  provisional: number
  statsCached: number
}

const round = (n: number, dp: number) => {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

// Which of a player's format tracks is featured as their public Joinzer Score.
// Prefer a format they're Established in (doubles wins ties); otherwise their
// most-played format (doubles wins ties). Ensures an earned rating is surfaced.
export function pickPrimaryFormat(tracks: PlayerRatingState[]): PlayerRatingState {
  const established = tracks.filter((t) => t.confidence === 'established')
  if (established.length) {
    return established.slice().sort((a, b) =>
      a.format === b.format ? b.gamesCounted - a.gamesCounted : a.format === 'doubles' ? -1 : 1,
    )[0]
  }
  return tracks.slice().sort((a, b) =>
    (b.gamesCounted - a.gamesCounted) || (a.format === 'doubles' ? -1 : 1),
  )[0]
}

export async function recomputeAllRatings(admin: SupabaseClient, opts: { asOf: string }): Promise<RecomputeSummary> {
  const games = await extractAllGameRecords(admin)

  // Seed each player from their self-report (provisional). Verified DUPR → tighter RD.
  const { data: profiles } = await admin.from('profiles').select('id, self_reported_rating, dupr_verified')
  const seedMap = new Map<string, { rating: number; rd: number }>()
  for (const p of (profiles ?? []) as any[]) {
    const score = provisionalScoreFromSelfReport(p.self_reported_rating)
    if (score == null) continue
    seedMap.set(p.id, { rating: internalFromScore('pickleball', score), rd: p.dupr_verified ? VERIFIED_DUPR_RD : DEFAULT_RD })
  }
  const seed: SeedFn = (pid) => seedMap.get(pid) ?? null

  const states = computeRatings(games, seed, { asOf: opts.asOf })

  // ── Write player_ratings (full replace) ──
  const rows = states.map((s) => ({
    player_id: s.playerId,
    activity: s.activity,
    format: s.format,
    internal_rating: round(s.rating, 4),
    rating_rd: round(s.rd, 4),
    rating_volatility: round(s.vol, 6),
    joinzer_score: scoreFromInternal(s.activity, s.rating),
    games_counted: s.gamesCounted,
    events_counted: s.eventsCounted,
    basis: s.basis,
    confidence_state: s.confidence,
    last_played_at: s.lastPlayedAt,
    updated_at: opts.asOf,
  }))
  await admin.from('player_ratings').delete().not('player_id', 'is', null)
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('player_ratings').insert(rows.slice(i, i + 500))
    if (error) throw new Error(`player_ratings insert: ${error.message}`)
  }

  // ── Profiles cache (primary format = the player's Established format, doubles winning
  //    ties; else their most-played format, doubles winning ties). ──
  const byPlayer = new Map<string, PlayerRatingState[]>()
  for (const s of states) {
    if (!byPlayer.has(s.playerId)) byPlayer.set(s.playerId, [])
    byPlayer.get(s.playerId)!.push(s)
  }
  const primary = new Map<string, PlayerRatingState>()
  for (const [pid, tracks] of byPlayer) primary.set(pid, pickPrimaryFormat(tracks))
  await admin.from('profiles')
    .update({ primary_format: null, primary_joinzer_score: null, primary_joinzer_level: null, primary_confidence: null, primary_games: null, primary_score_history: null })
    .not('primary_joinzer_score', 'is', null)
  const entries = [...primary.entries()]
  for (let i = 0; i < entries.length; i += 25) {
    const results = await Promise.all(entries.slice(i, i + 25).map(([pid, s]) => {
      const score = scoreFromInternal(s.activity, s.rating)
      return admin.from('profiles').update({
        primary_activity: s.activity,
        primary_format: s.format,
        primary_joinzer_score: score,
        primary_joinzer_level: scoreToLevel(s.activity, score),
        primary_confidence: s.confidence,
        primary_games: s.gamesCounted,
        primary_score_history: (s.history ?? []).slice(-12).map((h) => scoreFromInternal(s.activity, h.rating)),
      }).eq('id', pid)
    }))
    for (const { error } of results) if (error) throw new Error(`profiles cache update: ${error.message}`)
  }

  // ── Player-stats cache (Phase 2): same games, per-player career stats. ──
  const statsCached = await recomputePlayerStats(admin, games, opts.asOf)

  return {
    games: games.length,
    ratings: states.length,
    players: primary.size,
    established: states.filter((s) => s.confidence === 'established').length,
    rusty: states.filter((s) => s.confidence === 'rusty').length,
    provisional: states.filter((s) => s.confidence === 'provisional').length,
    statsCached,
  }
}
