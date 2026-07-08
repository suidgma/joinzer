// Rating engine — pure. Replays GameRecords chronologically in weekly rating periods
// and returns each (player, activity, format) Glicko rating. Doubles are handled by
// treating each player as playing a single virtual opponent = the opposing team's
// average (µ mean, RD root-mean-square). No DB, no I/O — see
// docs/phases/rating-engine-phase2.md §3. NOT wired to anything yet.

import { updateRating, applyInactivity, DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL, DEFAULT_TAU, type Glicko2Game } from './glicko2'
import type { GameRecord, RatingFormat } from './types'
import type { Activity } from './levels'

// Established gate (locked, §0): RD below threshold AND ≥15 games AND ≥3 distinct events.
export const ESTABLISHED_MAX_RD = 110
export const ESTABLISHED_MIN_GAMES = 15
export const ESTABLISHED_MIN_EVENTS = 3

export type SeedInput = { rating: number; rd?: number; vol?: number }
export type SeedFn = (playerId: string) => SeedInput | null

export type ConfidenceState = 'provisional' | 'established' | 'rusty'

// One snapshot per rating period the player competed in (for the trend sparkline).
export type RatingSnapshot = { at: string; rating: number; games: number }

export type PlayerRatingState = {
  playerId: string
  activity: Activity
  format: RatingFormat
  rating: number
  rd: number
  vol: number
  gamesCounted: number
  eventsCounted: number
  lastPlayedAt: string | null
  basis: 'seed' | 'calculated'
  confidence: ConfidenceState
  history: RatingSnapshot[]
}

type Track = {
  playerId: string
  activity: Activity
  format: RatingFormat
  rating: number
  rd: number
  vol: number
  lastWeek: number | null
  lastPlayedAt: string | null
  games: number
  occasions: Set<string>
  basis: 'seed' | 'calculated'
  snapshots: RatingSnapshot[]
}

const MS_PER_WEEK = 7 * 24 * 3600 * 1000
const weekIndex = (iso: string): number => Math.floor(new Date(iso).getTime() / MS_PER_WEEK)
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const rms = (xs: number[]) => Math.sqrt(mean(xs.map((x) => x * x)))
const trackKey = (playerId: string, activity: string, format: string) => `${playerId}|${activity}|${format}`

// Derive the public confidence state from a rating snapshot. "Rusty" = earned the volume
// but RD has regrown from inactivity; "provisional" = hasn't earned the volume yet.
export function confidenceState(s: { rd: number; gamesCounted: number; eventsCounted: number }): ConfidenceState {
  const meetsVolume = s.gamesCounted >= ESTABLISHED_MIN_GAMES && s.eventsCounted >= ESTABLISHED_MIN_EVENTS
  if (meetsVolume && s.rd < ESTABLISHED_MAX_RD) return 'established'
  if (meetsVolume) return 'rusty'
  return 'provisional'
}

export function computeRatings(
  games: GameRecord[],
  seed: SeedFn = () => null,
  opts: { tau?: number; asOf?: string } = {},
): PlayerRatingState[] {
  const tau = opts.tau ?? DEFAULT_TAU
  const tracks = new Map<string, Track>()

  const ensure = (playerId: string, activity: Activity, format: RatingFormat): Track => {
    const key = trackKey(playerId, activity, format)
    let t = tracks.get(key)
    if (!t) {
      const s = seed(playerId)
      t = {
        playerId, activity, format,
        rating: s?.rating ?? DEFAULT_RATING,
        rd: s?.rd ?? DEFAULT_RD,
        vol: s?.vol ?? DEFAULT_VOL,
        lastWeek: null, lastPlayedAt: null, games: 0, occasions: new Set(), basis: 'seed', snapshots: [],
      }
      tracks.set(key, t)
    }
    return t
  }

  // Grow RD across idle rating periods (capped at the default, where it saturates).
  const idle = (t: Track, periods: number) => {
    for (let i = 0; i < periods && t.rd < DEFAULT_RD; i++) {
      t.rd = applyInactivity({ rating: t.rating, rd: t.rd, vol: t.vol }).rd
    }
  }

  const sorted = [...games].sort((a, b) => a.playedAt.localeCompare(b.playedAt) || a.id.localeCompare(b.id))
  const byWeek = new Map<number, GameRecord[]>()
  for (const g of sorted) {
    const w = weekIndex(g.playedAt)
    if (!byWeek.has(w)) byWeek.set(w, [])
    byWeek.get(w)!.push(g)
  }

  for (const w of [...byWeek.keys()].sort((a, b) => a - b)) {
    const pending = new Map<string, Glicko2Game[]>()
    const pendingOcc = new Map<string, Set<string>>()
    const pendingLast = new Map<string, string>()

    // Collect this period's virtual 1v1 games using PRE-period ratings for aggregates.
    for (const g of byWeek.get(w)!) {
      if (g.sideA.length === 0 || g.sideB.length === 0) continue
      const all = [...g.sideA, ...g.sideB]
      if (new Set(all).size !== all.length) continue // a user on both sides → data error, skip
      for (const pid of all) ensure(pid, g.activity, g.format)
      const aggOf = (ids: string[]) => {
        const ts = ids.map((id) => tracks.get(trackKey(id, g.activity, g.format))!)
        return { rating: mean(ts.map((t) => t.rating)), rd: rms(ts.map((t) => t.rd)) }
      }
      const aggA = aggOf(g.sideA)
      const aggB = aggOf(g.sideB)
      const push = (pid: string, opp: { rating: number; rd: number }, score: number) => {
        const key = trackKey(pid, g.activity, g.format)
        if (!pending.has(key)) { pending.set(key, []); pendingOcc.set(key, new Set()) }
        pending.get(key)!.push({ opponentRating: opp.rating, opponentRd: opp.rd, score })
        pendingOcc.get(key)!.add(g.occasionId)
        const prev = pendingLast.get(key)
        if (!prev || g.playedAt > prev) pendingLast.set(key, g.playedAt)
      }
      for (const pid of g.sideA) push(pid, aggB, g.winner === 'A' ? 1 : 0)
      for (const pid of g.sideB) push(pid, aggA, g.winner === 'B' ? 1 : 0)
    }

    // One Glicko update per track this period (after gap-inactivity).
    for (const [key, glGames] of pending) {
      const t = tracks.get(key)!
      if (t.lastWeek != null) idle(t, w - t.lastWeek - 1)
      const upd = updateRating({ rating: t.rating, rd: t.rd, vol: t.vol }, glGames, tau)
      t.rating = upd.rating; t.rd = upd.rd; t.vol = upd.vol
      t.lastWeek = w
      t.games += glGames.length
      for (const occ of pendingOcc.get(key)!) t.occasions.add(occ)
      t.lastPlayedAt = pendingLast.get(key)!
      t.basis = 'calculated'
      t.snapshots.push({ at: t.lastPlayedAt, rating: t.rating, games: t.games })
    }
  }

  // Final inactivity to "now" so RD (and the rusty state) reflect current idleness.
  if (opts.asOf) {
    const asOfW = weekIndex(opts.asOf)
    for (const t of tracks.values()) if (t.lastWeek != null) idle(t, asOfW - t.lastWeek)
  }

  return [...tracks.values()].map((t) => ({
    playerId: t.playerId, activity: t.activity, format: t.format,
    rating: t.rating, rd: t.rd, vol: t.vol,
    gamesCounted: t.games, eventsCounted: t.occasions.size,
    lastPlayedAt: t.lastPlayedAt, basis: t.basis,
    confidence: confidenceState({ rd: t.rd, gamesCounted: t.games, eventsCounted: t.occasions.size }),
    history: t.snapshots,
  }))
}
