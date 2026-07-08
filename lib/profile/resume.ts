// Server loader for the public player-profile résumé (Phase 1). Assembles the PII-safe
// profile identity, per-format Joinzer ratings, computed competitive career stats, and
// upcoming competitive events into one typed object for the players/[id] page.
//
// Reads via the service-role client (player_ratings + the rating extractor hit RLS
// deny-all tables). Selects ONLY public-safe columns — never email/phone.
// See docs/phases/player-profile-phase1.md §7.

import type { SupabaseClient } from '@supabase/supabase-js'
import { extractAllGameRecords } from '../rating/extract'
import { computePlayerStats, type PlayerStats } from '../rating/stats'
import { computeBadges, type Badge } from './badges'
import type { RatingFormat } from '../rating/types'

// The profile fields the hero + rating block need. Shaped to pass straight into
// ratingDisplay() / RatingBadge without adaptation.
export type ResumeProfile = {
  id: string
  name: string | null
  displayName: string | null
  photoUrl: string | null
  gender: string | null
  memberSinceYear: number | null
  homeCourtName: string | null
  bio: string | null
  dominantHand: string | null
  preferredSide: string | null
  preferredFormats: string[]
  // rating display inputs
  primary_joinzer_score: number | null
  primary_joinzer_level: string | null
  primary_confidence: string | null
  primary_games: number | null
  primary_score_history: number[] | null
  self_reported_rating: number | null
  self_reported_scale: string | null
  dupr_rating: number | null
  dupr_verified: boolean
}
export type ResumeFormatRating = { format: RatingFormat; score: number | null; confidence: string | null; games: number; events: number }
export type ResumeUpcoming = { kind: 'league' | 'tournament'; id: string; name: string; date: string | null; location: string | null }
export type PlayerResume = {
  profile: ResumeProfile
  ratings: ResumeFormatRating[]
  stats: PlayerStats
  badges: Badge[]
  upcoming: ResumeUpcoming[]
}

export async function loadPlayerResume(admin: SupabaseClient, userId: string): Promise<PlayerResume | null> {
  const { data: p } = await admin
    .from('profiles')
    .select('id, name, display_name, profile_photo_url, gender, created_at, bio, dominant_hand, preferred_side, preferred_formats, primary_joinzer_score, primary_joinzer_level, primary_confidence, primary_games, primary_score_history, self_reported_rating, self_reported_scale, rating_source, estimated_rating, dupr_rating, dupr_verified, home_court:locations!home_court_id(name)')
    .eq('id', userId)
    .maybeSingle()
  if (!p) return null
  const prof = p as any

  // Per-format Joinzer ratings (singles vs doubles), pickleball only for v1.
  const { data: prRows } = await admin
    .from('player_ratings')
    .select('format, joinzer_score, confidence_state, games_counted, events_counted')
    .eq('player_id', userId)
    .eq('activity', 'pickleball')
  const ratings: ResumeFormatRating[] = (prRows ?? []).map((r: any) => ({
    format: r.format as RatingFormat,
    score: r.joinzer_score ?? null,
    confidence: r.confidence_state ?? null,
    games: r.games_counted ?? 0,
    events: r.events_counted ?? 0,
  }))

  // Competitive career stats — read the nightly cron cache; fall back to compute-on-read
  // when a row is missing (new/zero-match players before the next run).
  const { data: cached } = await admin.from('player_stats').select('stats').eq('player_id', userId).maybeSingle()
  const stats: PlayerStats = (cached as { stats: PlayerStats } | null)?.stats
    ?? computePlayerStats(await extractAllGameRecords(admin), userId)

  const badges = computeBadges({
    createdAt: prof.created_at ?? null,
    confidence: prof.primary_confidence ?? null,
    matches: stats.matches,
    leaguesPlayed: stats.leaguesPlayed,
    tournamentsPlayed: stats.tournamentsPlayed,
    currentStreak: stats.currentStreak,
  })

  // Upcoming competitive events only (leagues not yet ended + future tournaments).
  const today = new Date().toISOString().slice(0, 10)
  const [{ data: leagueRegs }, { data: tourRegs }] = await Promise.all([
    admin.from('league_registrations')
      .select('league:leagues!league_id(id, name, start_date, end_date, location_name)')
      .eq('user_id', userId).eq('status', 'registered'),
    admin.from('tournament_registrations')
      .select('tournament:tournaments!tournament_id(id, name, start_date, location:locations!location_id(name))')
      .eq('user_id', userId).in('status', ['registered', 'confirmed', 'approved']),
  ])

  const upcoming: ResumeUpcoming[] = []
  for (const row of (leagueRegs ?? []) as any[]) {
    const l = row.league
    if (!l) continue
    const boundary = l.end_date ?? l.start_date
    if (boundary && boundary >= today) {
      upcoming.push({ kind: 'league', id: l.id, name: l.name, date: l.start_date ?? null, location: l.location_name ?? null })
    }
  }
  for (const row of (tourRegs ?? []) as any[]) {
    const t = row.tournament
    if (!t) continue
    if (t.start_date && t.start_date >= today) {
      upcoming.push({ kind: 'tournament', id: t.id, name: t.name, date: t.start_date, location: t.location?.name ?? null })
    }
  }
  upcoming.sort((a, b) => (a.date ?? '') < (b.date ?? '') ? -1 : (a.date ?? '') > (b.date ?? '') ? 1 : 0)

  // Legacy fallback: pre-Phase-0 rows may lack self_reported_* — derive from the old
  // rating_source/estimated_rating/dupr_rating (mirrors the previous profile page).
  const selfRating: number | null = prof.self_reported_rating
    ?? (prof.rating_source === 'estimated' ? prof.estimated_rating : prof.rating_source === 'dupr_known' ? prof.dupr_rating : null)
  const selfScale: string | null = prof.self_reported_scale
    ?? (prof.rating_source === 'dupr_known' ? 'dupr' : prof.rating_source === 'estimated' ? 'self' : null)

  return {
    profile: {
      id: prof.id,
      name: prof.name ?? null,
      displayName: prof.display_name ?? null,
      photoUrl: prof.profile_photo_url ?? null,
      gender: prof.gender ?? null,
      memberSinceYear: prof.created_at ? new Date(prof.created_at).getUTCFullYear() : null,
      homeCourtName: prof.home_court?.name ?? null,
      bio: prof.bio ?? null,
      dominantHand: prof.dominant_hand ?? null,
      preferredSide: prof.preferred_side ?? null,
      preferredFormats: Array.isArray(prof.preferred_formats) ? (prof.preferred_formats as string[]) : [],
      primary_joinzer_score: prof.primary_joinzer_score ?? null,
      primary_joinzer_level: prof.primary_joinzer_level ?? null,
      primary_confidence: prof.primary_confidence ?? null,
      primary_games: prof.primary_games ?? null,
      primary_score_history: Array.isArray(prof.primary_score_history) ? (prof.primary_score_history as number[]) : null,
      self_reported_rating: selfRating,
      self_reported_scale: selfScale,
      dupr_rating: prof.dupr_rating ?? null,
      dupr_verified: prof.dupr_verified ?? false,
    },
    ratings,
    stats,
    badges,
    upcoming,
  }
}
