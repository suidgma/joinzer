/**
 * League Session Scheduler
 *
 * Pure functions — no I/O, fully testable.
 *
 * Flow:
 *   1. determineRoundFormat()  — how many doubles/singles/byes given N players + courts
 *   2. deriveHistory()         — build partner/opponent/bye counts from completed rounds
 *   3. generateNextRound()     — produce 1 000 random candidates, score, return best
 *
 * Scoring weights:
 *   Repeat partner          –1 000  (strongest avoidance)
 *   Repeat bye              –  500
 *   Repeat singles          –  400  (per player in the match)
 *   Late player gets bye    –  300
 *   Repeat opponent         –  200
 *   Sub in singles          + 150   (preference)
 *   Late player scheduled   + 150   (priority)
 *   Player with fewer games + 100   (balance)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type PlayerType   = 'roster_player' | 'sub' | 'guest'
export type ActualStatus = 'present' | 'not_present' | 'late' | 'left_early'
export type MatchType    = 'doubles' | 'singles' | 'bye'
export type RoundStatus  = 'draft' | 'locked' | 'completed'

export type SessionPlayer = {
  id: string                    // league_session_players.id
  userId: string | null
  name: string
  playerType: PlayerType
  actualStatus: ActualStatus
  arrivedAfterRound: number | null
  joinzerRating: number         // default 1 000
}

export type CompletedMatch = {
  matchType: MatchType
  team1: string[]               // [player1Id, player2Id] (doubles only)
  team2: string[]
  singles: string[]             // [player1Id, player2Id] (singles only)
  byePlayerId: string | null
}

export type CompletedRound = {
  roundNumber: number
  matches: CompletedMatch[]
}

export type RoundFormat = {
  doublesCount: number
  singlesCount: number
  byeCount: number
  activePlayers: number
  warning?: string
}

export type GeneratedMatch = {
  courtNumber: number | null
  matchType: MatchType
  team1Player1Id: string | null
  team1Player2Id: string | null
  team2Player1Id: string | null
  team2Player2Id: string | null
  singlesPlayer1Id: string | null
  singlesPlayer2Id: string | null
  byePlayerId: string | null
}

export type GeneratedRound = {
  matches: GeneratedMatch[]
  notes: string[]
  score: number
  format: RoundFormat
}

// ─── History ─────────────────────────────────────────────────────────────────

type PlayerHistory = {
  gamesPlayed: number
  singles: number
  byes: number
  partners: Record<string, number>   // partnerId → times partnered
  opponents: Record<string, number>  // opponentId → times faced
}

type History = Record<string, PlayerHistory>

function ensure(h: History, id: string) {
  if (!h[id]) h[id] = { gamesPlayed: 0, singles: 0, byes: 0, partners: {}, opponents: {} }
}
function inc(obj: Record<string, number>, key: string) {
  obj[key] = (obj[key] ?? 0) + 1
}

export function deriveHistory(completedRounds: CompletedRound[]): History {
  const h: History = {}

  for (const round of completedRounds) {
    for (const m of round.matches) {
      if (m.matchType === 'doubles') {
        const [p1, p2] = m.team1
        const [p3, p4] = m.team2
        if (!p1 || !p2 || !p3 || !p4) continue

        for (const id of [p1, p2, p3, p4]) { ensure(h, id); h[id].gamesPlayed++ }

        // Partners
        inc(h[p1].partners, p2); inc(h[p2].partners, p1)
        inc(h[p3].partners, p4); inc(h[p4].partners, p3)

        // Opponents
        for (const a of [p1, p2]) for (const b of [p3, p4]) {
          inc(h[a].opponents, b); inc(h[b].opponents, a)
        }
      } else if (m.matchType === 'singles') {
        const [p1, p2] = m.singles
        if (!p1 || !p2) continue
        ensure(h, p1); ensure(h, p2)
        h[p1].gamesPlayed++; h[p2].gamesPlayed++
        h[p1].singles++;     h[p2].singles++
        inc(h[p1].opponents, p2); inc(h[p2].opponents, p1)
      } else if (m.matchType === 'bye' && m.byePlayerId) {
        ensure(h, m.byePlayerId)
        h[m.byePlayerId].byes++
      }
    }
  }

  return h
}

// ─── Round format ─────────────────────────────────────────────────────────────

/**
 * Determines how many doubles / singles / bye slots a round should have.
 *
 * Rule: maximise doubles within court limit; use leftover players for
 * singles (if a court is free) or byes.
 */
export function determineRoundFormat(presentCount: number, courts: number): RoundFormat {
  const c = Math.max(1, courts)

  if (presentCount < 2) {
    return { doublesCount: 0, singlesCount: 0, byeCount: 0, activePlayers: 0, warning: 'Not enough players for any match.' }
  }

  const maxDoubles = Math.min(Math.floor(presentCount / 4), c)
  const remainder  = presentCount - maxDoubles * 4
  const courtsLeft = c - maxDoubles

  let doublesCount = maxDoubles
  let singlesCount = 0
  let byeCount     = 0

  if (remainder === 0) {
    // perfect fit
  } else if (remainder === 1) {
    byeCount = 1
  } else if (remainder === 2) {
    if (courtsLeft >= 1) singlesCount = 1
    else byeCount = 2
  } else {
    // remainder === 3
    if (courtsLeft >= 1) { singlesCount = 1; byeCount = 1 }
    else byeCount = remainder
  }

  const warning = presentCount < 8
    ? `Only ${presentCount} players present — may not be enough for standard league play.`
    : undefined

  return { doublesCount, singlesCount, byeCount, activePlayers: presentCount, warning }
}

// ─── Candidate generation ────────────────────────────────────────────────────

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function generateCandidate(
  present: SessionPlayer[],
  format: RoundFormat,
): GeneratedMatch[] {
  const subs    = present.filter(p => p.playerType === 'sub')
  const nonSubs = present.filter(p => p.playerType !== 'sub')

  let singlesIds: string[] = []
  let pool = [...present]

  // --- Assign singles players (prefer subs) ---
  if (format.singlesCount > 0) {
    if (subs.length >= 2) {
      const s = shuffle(subs)
      singlesIds = [s[0].id, s[1].id]
    } else if (subs.length === 1) {
      const others = shuffle(nonSubs)
      singlesIds = [subs[0].id, others[0].id]
    } else {
      const s = shuffle(pool)
      singlesIds = [s[0].id, s[1].id]
    }
    pool = pool.filter(p => !singlesIds.includes(p.id))
  }

  // --- Shuffle remaining pool, assign byes then doubles ---
  const shuffled      = shuffle(pool)
  const byePlayers    = shuffled.slice(0, format.byeCount)
  const doublesPlayers = shuffled.slice(format.byeCount)

  const matches: GeneratedMatch[] = []
  let court = 1

  for (let i = 0; i < format.doublesCount; i++) {
    const b = i * 4
    matches.push({
      courtNumber:     court++,
      matchType:       'doubles',
      team1Player1Id:  doublesPlayers[b]?.id     ?? null,
      team1Player2Id:  doublesPlayers[b + 1]?.id ?? null,
      team2Player1Id:  doublesPlayers[b + 2]?.id ?? null,
      team2Player2Id:  doublesPlayers[b + 3]?.id ?? null,
      singlesPlayer1Id: null,
      singlesPlayer2Id: null,
      byePlayerId:     null,
    })
  }

  if (singlesIds.length === 2) {
    matches.push({
      courtNumber:     court++,
      matchType:       'singles',
      team1Player1Id:  null,
      team1Player2Id:  null,
      team2Player1Id:  null,
      team2Player2Id:  null,
      singlesPlayer1Id: singlesIds[0],
      singlesPlayer2Id: singlesIds[1],
      byePlayerId:     null,
    })
  }

  for (const p of byePlayers) {
    matches.push({
      courtNumber:     null,
      matchType:       'bye',
      team1Player1Id:  null,
      team1Player2Id:  null,
      team2Player1Id:  null,
      team2Player2Id:  null,
      singlesPlayer1Id: null,
      singlesPlayer2Id: null,
      byePlayerId:     p.id,
    })
  }

  return matches
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function scoreCandidate(
  matches: GeneratedMatch[],
  history: History,
  present: SessionPlayer[],
): number {
  let score = 0
  const byId = Object.fromEntries(present.map(p => [p.id, p]))

  for (const m of matches) {
    if (m.matchType === 'doubles') {
      const { team1Player1Id: p1, team1Player2Id: p2, team2Player1Id: p3, team2Player2Id: p4 } = m
      if (!p1 || !p2 || !p3 || !p4) { score -= 10000; continue }

      // Partner repeats (strongest penalty)
      score -= (history[p1]?.partners[p2] ?? 0) * 1000
      score -= (history[p3]?.partners[p4] ?? 0) * 1000

      // Opponent repeats
      for (const a of [p1, p2]) for (const b of [p3, p4]) {
        score -= (history[a]?.opponents[b] ?? 0) * 200
      }

      // Reward scheduling players with fewer games
      for (const id of [p1, p2, p3, p4]) {
        const games = history[id]?.gamesPlayed ?? 0
        if (games < 3) score += 100

        // Reward late-arriving player getting scheduled
        if (byId[id]?.arrivedAfterRound != null) score += 150
      }
    }

    if (m.matchType === 'singles') {
      const { singlesPlayer1Id: p1, singlesPlayer2Id: p2 } = m
      if (!p1 || !p2) { score -= 10000; continue }

      // Singles repeat penalty (per player)
      score -= (history[p1]?.singles ?? 0) * 400
      score -= (history[p2]?.singles ?? 0) * 400

      // Singles opponent repeat
      score -= (history[p1]?.opponents[p2] ?? 0) * 200

      // Reward sub in singles
      if (byId[p1]?.playerType === 'sub') score += 150
      if (byId[p2]?.playerType === 'sub') score += 150
    }

    if (m.matchType === 'bye') {
      const { byePlayerId: pid } = m
      if (!pid) continue

      // Repeat bye penalty
      score -= (history[pid]?.byes ?? 0) * 500

      // Extra penalty: late arrival gets bye
      if (byId[pid]?.arrivedAfterRound != null) score -= 300
    }
  }

  return score
}

// ─── Generation notes ────────────────────────────────────────────────────────

function buildNotes(
  matches: GeneratedMatch[],
  history: History,
  present: SessionPlayer[],
  format: RoundFormat,
): string[] {
  const byId = Object.fromEntries(present.map(p => [p.id, p]))
  const notes: string[] = []

  let repeatPartner = false
  let repeatOpponent = false
  let subInSingles = false
  let lateScheduled = false
  let unavoidableBye = false

  for (const m of matches) {
    if (m.matchType === 'doubles') {
      const { team1Player1Id: p1, team1Player2Id: p2, team2Player1Id: p3, team2Player2Id: p4 } = m
      if (p1 && p2 && (history[p1]?.partners[p2] ?? 0) > 0) repeatPartner = true
      if (p3 && p4 && (history[p3]?.partners[p4] ?? 0) > 0) repeatPartner = true
      if (p1 && p3 && (history[p1]?.opponents[p3] ?? 0) > 0) repeatOpponent = true

      for (const id of [p1, p2, p3, p4]) {
        if (id && byId[id]?.arrivedAfterRound != null) lateScheduled = true
      }
    }

    if (m.matchType === 'singles') {
      const { singlesPlayer1Id: p1, singlesPlayer2Id: p2 } = m
      if (p1 && byId[p1]?.playerType === 'sub') subInSingles = true
      if (p2 && byId[p2]?.playerType === 'sub') subInSingles = true
    }

    if (m.matchType === 'bye') {
      const pid = m.byePlayerId
      if (pid && (history[pid]?.byes ?? 0) > 0) unavoidableBye = true
    }
  }

  if (!repeatPartner)  notes.push('No repeated partners.')
  else                 notes.push('One or more repeated partners — unavoidable with current roster.')

  if (repeatOpponent)  notes.push('Some repeated opponents — unavoidable with this roster size.')
  if (subInSingles)    notes.push('Sub player(s) assigned to singles match.')
  if (lateScheduled)   notes.push('Late-arriving player prioritized into this round.')
  if (unavoidableBye)  notes.push('A player received a repeated bye — unavoidable given current count.')
  if (format.warning)  notes.push(format.warning)

  return notes
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function generateNextRound(
  players: SessionPlayer[],
  completedRounds: CompletedRound[],
  courts: number,
  roundNumber: number,
  candidateCount = 1000,
): GeneratedRound | null {
  const present = players.filter(p => p.actualStatus === 'present')
  if (present.length < 2) return null

  const format  = determineRoundFormat(present.length, courts)
  const history = deriveHistory(completedRounds)

  let bestMatches: GeneratedMatch[] | null = null
  let bestScore = -Infinity

  for (let i = 0; i < candidateCount; i++) {
    const matches = generateCandidate(present, format)

    // Reject invalid candidates (missing required players)
    const valid = matches.every(m => {
      if (m.matchType === 'doubles') return m.team1Player1Id && m.team1Player2Id && m.team2Player1Id && m.team2Player2Id
      if (m.matchType === 'singles') return m.singlesPlayer1Id && m.singlesPlayer2Id
      if (m.matchType === 'bye')     return !!m.byePlayerId
      return false
    })
    if (!valid) continue

    const score = scoreCandidate(matches, history, present)
    if (score > bestScore) { bestScore = score; bestMatches = matches }
  }

  if (!bestMatches) return null

  return {
    matches: bestMatches,
    notes:   buildNotes(bestMatches, history, present, format),
    score:   bestScore,
    format,
  }
}

// ─── Fairness summary (used by UI) ───────────────────────────────────────────

export type FairnessRow = {
  playerId: string
  name: string
  gamesPlayed: number
  singles: number
  byes: number
  repeatPartners: number
  repeatOpponents: number
}

export function buildFairnessSummary(
  players: SessionPlayer[],
  completedRounds: CompletedRound[],
): FairnessRow[] {
  const history = deriveHistory(completedRounds)

  return players.map(p => {
    const h = history[p.id]
    const repeatPartners  = Object.values(h?.partners  ?? {}).filter(n => n > 1).length
    const repeatOpponents = Object.values(h?.opponents ?? {}).filter(n => n > 1).length
    return {
      playerId: p.id,
      name: p.name,
      gamesPlayed: h?.gamesPlayed ?? 0,
      singles:     h?.singles     ?? 0,
      byes:        h?.byes        ?? 0,
      repeatPartners,
      repeatOpponents,
    }
  }).sort((a, b) => b.gamesPlayed - a.gamesPlayed)
}
