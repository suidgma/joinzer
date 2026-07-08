// Pure career-stats aggregator for the player-profile résumé. Consumes the normalized,
// source-agnostic GameRecords from extract.ts (competitive only — leagues + tournaments)
// and derives one player's matches / W-L / win% / streak / recent form / format split /
// competitions played. No I/O; the server loader supplies the records.
// See docs/phases/player-profile-phase1.md §5.

import type { GameRecord, RatingFormat } from './types'

export type FormatSplit = { matches: number; wins: number; losses: number }

export type PlayerStats = {
  matches: number
  wins: number
  losses: number
  winPct: number // 0..1; 0 when no matches (no ties exist — extract.ts drops them)
  currentStreak: { type: 'W' | 'L'; count: number } | null
  recentForm: ('W' | 'L')[] // last up-to-10, chronological (oldest → newest)
  recentRecord: { wins: number; losses: number } // over that last-10 window
  byFormat: Record<RatingFormat, FormatSplit>
  leaguesPlayed: number // distinct league competitionIds
  tournamentsPlayed: number // distinct tournament competitionIds
  eventsPlayed: number // distinct competitions total (leagues + tournaments)
}

const RECENT_WINDOW = 10

const emptySplit = (): FormatSplit => ({ matches: 0, wins: 0, losses: 0 })

export function computePlayerStats(records: GameRecord[], userId: string): PlayerStats {
  // This player's matches, chronological (stable tiebreak on id for equal timestamps).
  const mine = records
    .filter((r) => r.sideA.includes(userId) || r.sideB.includes(userId))
    .map((r) => ({ r, won: (r.sideA.includes(userId) ? 'A' : 'B') === r.winner }))
    .sort((a, b) =>
      a.r.playedAt < b.r.playedAt ? -1
        : a.r.playedAt > b.r.playedAt ? 1
          : a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0,
    )

  const matches = mine.length
  let wins = 0
  const byFormat: Record<RatingFormat, FormatSplit> = { doubles: emptySplit(), singles: emptySplit() }
  const leagues = new Set<string>()
  const tournaments = new Set<string>()

  for (const { r, won } of mine) {
    if (won) wins++
    const f = byFormat[r.format]
    f.matches++
    if (won) f.wins++
    else f.losses++
    if (r.source === 'league') leagues.add(r.competitionId)
    else tournaments.add(r.competitionId)
  }

  const losses = matches - wins
  const winPct = matches > 0 ? wins / matches : 0

  // Current streak — walk back from the most recent match.
  let currentStreak: { type: 'W' | 'L'; count: number } | null = null
  if (matches > 0) {
    const latestWon = mine[matches - 1].won
    let count = 0
    for (let i = matches - 1; i >= 0 && mine[i].won === latestWon; i--) count++
    currentStreak = { type: latestWon ? 'W' : 'L', count }
  }

  // Recent form — last up-to-10, chronological (oldest → newest).
  const window = mine.slice(Math.max(0, matches - RECENT_WINDOW))
  const recentForm = window.map((x): 'W' | 'L' => (x.won ? 'W' : 'L'))
  const recentRecord = {
    wins: window.filter((x) => x.won).length,
    losses: window.filter((x) => !x.won).length,
  }

  return {
    matches,
    wins,
    losses,
    winPct,
    currentStreak,
    recentForm,
    recentRecord,
    byFormat,
    leaguesPlayed: leagues.size,
    tournamentsPlayed: tournaments.size,
    eventsPlayed: leagues.size + tournaments.size,
  }
}
