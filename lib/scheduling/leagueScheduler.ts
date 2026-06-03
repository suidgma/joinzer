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
export type GenderBucket = 'male' | 'female' | 'other'

export type SessionPlayer = {
  id: string                    // league_session_players.id
  userId: string | null
  name: string
  playerType: PlayerType
  actualStatus: ActualStatus
  arrivedAfterRound: number | null
  joinzerRating: number         // default 1 000
  gender?: string | null        // from profiles.gender; only used in mixed_doubles mode
}

/**
 * Normalizes a raw profiles.gender value into one of three buckets. Mixed
 * doubles needs to tell men from women; anything else (null, 'other', unknown)
 * falls into 'other' and is treated as un-pairable for the M+F constraint.
 */
export function genderBucket(g: string | null | undefined): GenderBucket {
  if (!g) return 'other'
  const s = g.trim().toLowerCase()
  if (s === 'male' || s === 'm' || s === 'man' || s === 'men') return 'male'
  if (s === 'female' || s === 'f' || s === 'woman' || s === 'women') return 'female'
  return 'other'
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
 * Determines how many singles / bye slots a round should have for a singles-format league.
 * All matches are singles; doublesCount is always 0.
 */
export function determineRoundFormatSingles(presentCount: number, courts: number): RoundFormat {
  const c = Math.max(1, courts)
  if (presentCount < 2) {
    return { doublesCount: 0, singlesCount: 0, byeCount: 0, activePlayers: 0, warning: 'Not enough players for any match.' }
  }
  const singlesCount = Math.min(Math.floor(presentCount / 2), c)
  const byeCount = presentCount - singlesCount * 2
  const warning = presentCount < 4
    ? `Only ${presentCount} players present — may not be enough for standard league play.`
    : undefined
  return { doublesCount: 0, singlesCount, byeCount, activePlayers: presentCount, warning }
}

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

/**
 * Round format for fixed-partner mode.
 *
 * Constraints in fixed mode:
 *   - Every doubles match uses two whole pairs (4 players from 2 known pairs).
 *   - A pair whose other half is absent becomes one "orphan" (present partner
 *     of an absent player). Orphans can fill singles slots or take byes, but
 *     are never re-paired into doubles.
 *   - A pair that doesn't fit in a doubles court has both members byed.
 */
export function determineRoundFormatFixed(
  presentPairCount: number,
  orphanCount: number,
  courts: number,
): RoundFormat {
  const c = Math.max(1, courts)
  const presentCount = presentPairCount * 2 + orphanCount

  if (presentCount < 2) {
    return { doublesCount: 0, singlesCount: 0, byeCount: 0, activePlayers: 0, warning: 'Not enough players for any match.' }
  }

  // Whole pairs feeding doubles courts.
  const maxDoublesByPairs  = Math.floor(presentPairCount / 2)
  const maxDoublesByCourts = c
  const doublesCount       = Math.min(maxDoublesByPairs, maxDoublesByCourts)
  const courtsLeft         = c - doublesCount

  // Pairs that didn't get a doubles court → both members take a bye together.
  const leftoverPairs = presentPairCount - doublesCount * 2
  let byeCount        = leftoverPairs * 2

  // Orphans (one half of a pair, partner absent) can fill a singles court if free.
  let singlesCount = 0
  let unplacedOrphans = orphanCount
  if (courtsLeft >= 1 && unplacedOrphans >= 2) {
    singlesCount = 1
    unplacedOrphans -= 2
  }
  byeCount += unplacedOrphans

  const warning = presentCount < 8
    ? `Only ${presentCount} players present — may not be enough for standard league play.`
    : undefined

  return { doublesCount, singlesCount, byeCount, activePlayers: presentCount, warning }
}

/**
 * Round format for mixed-doubles (rotating) mode.
 *
 * Every doubles match must be two mixed teams: one man + one woman per side,
 * i.e. each match consumes exactly 2 men + 2 women. The number of mixed matches
 * is therefore bounded by the scarcer gender and the court count:
 *   doublesCount = min(floor(M/2), floor(F/2), courts)
 *
 * Leftover players (the surplus gender plus any 'other'/unspecified) fill
 * singles courts if any remain, otherwise bye. A roster-balance warning is
 * surfaced when the genders don't divide evenly into mixed teams.
 */
export function determineRoundFormatMixed(
  maleCount: number,
  femaleCount: number,
  otherCount: number,
  courts: number,
): RoundFormat {
  const c = Math.max(1, courts)
  const presentCount = maleCount + femaleCount + otherCount

  if (presentCount < 2) {
    return { doublesCount: 0, singlesCount: 0, byeCount: 0, activePlayers: 0, warning: 'Not enough players for any match.' }
  }

  const doublesCount = Math.min(Math.floor(maleCount / 2), Math.floor(femaleCount / 2), c)
  const leftover     = presentCount - doublesCount * 4
  const courtsLeft   = c - doublesCount

  let singlesCount = 0
  let byeCount     = 0
  if (leftover >= 2 && courtsLeft >= 1) {
    singlesCount = Math.min(Math.floor(leftover / 2), courtsLeft)
    byeCount     = leftover - singlesCount * 2
  } else {
    byeCount = leftover
  }

  let warning: string | undefined
  if (doublesCount === 0) {
    warning = `Cannot form a mixed doubles match — need at least 2 men and 2 women present (have ${maleCount} men, ${femaleCount} women).`
  } else if (maleCount !== femaleCount || otherCount > 0) {
    const detail = otherCount > 0
      ? `${maleCount} men, ${femaleCount} women, ${otherCount} unspecified`
      : `${maleCount} men, ${femaleCount} women`
    warning = `Roster is gender-imbalanced (${detail}) — not everyone can play mixed doubles each round.`
  }

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

// ─── Singles-only candidate generation ───────────────────────────────────────

/**
 * Builds one round candidate for a singles-only league: assign byes first,
 * then pair the rest into 1v1 singles matches across the available courts.
 */
function generateSinglesCandidate(
  present: SessionPlayer[],
  format: RoundFormat,
): GeneratedMatch[] {
  const shuffled   = shuffle(present)
  const byePlayers = shuffled.slice(0, format.byeCount)
  const playing    = shuffled.slice(format.byeCount)

  const matches: GeneratedMatch[] = []
  let court = 1

  for (let i = 0; i < format.singlesCount; i++) {
    const b = i * 2
    matches.push({
      courtNumber:      court++,
      matchType:        'singles',
      team1Player1Id:   null,
      team1Player2Id:   null,
      team2Player1Id:   null,
      team2Player2Id:   null,
      singlesPlayer1Id: playing[b]?.id     ?? null,
      singlesPlayer2Id: playing[b + 1]?.id ?? null,
      byePlayerId:      null,
    })
  }

  for (const p of byePlayers) {
    matches.push({
      courtNumber:      null,
      matchType:        'bye',
      team1Player1Id:   null,
      team1Player2Id:   null,
      team2Player1Id:   null,
      team2Player2Id:   null,
      singlesPlayer1Id: null,
      singlesPlayer2Id: null,
      byePlayerId:      p.id,
    })
  }

  return matches
}

// ─── Mixed-doubles candidate generation ──────────────────────────────────────

/**
 * Builds one round candidate for a mixed-doubles league. Each doubles match is
 * two mixed teams (1 man + 1 woman per side). Surplus players (the abundant
 * gender plus any 'other') fill singles courts or take byes.
 */
function generateMixedCandidate(
  present: SessionPlayer[],
  format: RoundFormat,
): GeneratedMatch[] {
  const males   = shuffle(present.filter(p => genderBucket(p.gender) === 'male'))
  const females = shuffle(present.filter(p => genderBucket(p.gender) === 'female'))
  const others  = shuffle(present.filter(p => genderBucket(p.gender) === 'other'))

  const usedPerGender = format.doublesCount * 2
  const doublesM = males.slice(0, usedPerGender)
  const doublesF = females.slice(0, usedPerGender)

  const matches: GeneratedMatch[] = []
  let court = 1

  // Doubles: each match pairs one man + one woman per team.
  for (let i = 0; i < format.doublesCount; i++) {
    const b = i * 2
    matches.push({
      courtNumber:      court++,
      matchType:        'doubles',
      team1Player1Id:   doublesM[b]?.id     ?? null,
      team1Player2Id:   doublesF[b]?.id     ?? null,
      team2Player1Id:   doublesM[b + 1]?.id ?? null,
      team2Player2Id:   doublesF[b + 1]?.id ?? null,
      singlesPlayer1Id: null,
      singlesPlayer2Id: null,
      byePlayerId:      null,
    })
  }

  // Everyone not placed in a mixed match (surplus gender + others).
  const leftover = shuffle([
    ...males.slice(usedPerGender),
    ...females.slice(usedPerGender),
    ...others,
  ])

  for (let i = 0; i < format.singlesCount; i++) {
    const b = i * 2
    matches.push({
      courtNumber:      court++,
      matchType:        'singles',
      team1Player1Id:   null,
      team1Player2Id:   null,
      team2Player1Id:   null,
      team2Player2Id:   null,
      singlesPlayer1Id: leftover[b]?.id     ?? null,
      singlesPlayer2Id: leftover[b + 1]?.id ?? null,
      byePlayerId:      null,
    })
  }

  for (const p of leftover.slice(format.singlesCount * 2)) {
    matches.push({
      courtNumber:      null,
      matchType:        'bye',
      team1Player1Id:   null,
      team1Player2Id:   null,
      team2Player1Id:   null,
      team2Player2Id:   null,
      singlesPlayer1Id: null,
      singlesPlayer2Id: null,
      byePlayerId:      p.id,
    })
  }

  return matches
}

// ─── Fixed-partner candidate generation ──────────────────────────────────────

/**
 * Resolves the input pair map to (presentPairs, orphans) given which session
 * players are actually present today. A "pair" here is the canonical pair from
 * registration (Alice + Bob). If both are present, they go to presentPairs. If
 * only one is present, that one is an "orphan" (still plays, just not as
 * doubles).
 *
 * Pairs are deduped by canonical ordering (smaller id first) so the same pair
 * isn't returned twice.
 */
export function resolvePresentPairs(
  present: SessionPlayer[],
  fixedPairs: ReadonlyMap<string, string>,
): { presentPairs: Array<[string, string]>; orphans: string[] } {
  const presentIds = new Set(present.map(p => p.id))
  const seen       = new Set<string>()
  const presentPairs: Array<[string, string]> = []
  const orphans: string[] = []

  for (const player of present) {
    const partnerId = fixedPairs.get(player.id) ?? null

    if (!partnerId) {
      orphans.push(player.id)
      continue
    }

    const canonical = player.id < partnerId ? `${player.id}|${partnerId}` : `${partnerId}|${player.id}`
    if (seen.has(canonical)) continue
    seen.add(canonical)

    if (presentIds.has(partnerId)) {
      presentPairs.push([player.id, partnerId])
    } else {
      // Partner absent → present partner plays as an orphan this round.
      orphans.push(player.id)
    }
  }

  return { presentPairs, orphans }
}

/**
 * Builds one round candidate honoring fixed pairs.
 *
 * Doubles matches always combine two whole pairs. Orphans (players whose
 * fixed partner is absent) take singles or byes. Pairs that don't fit on a
 * doubles court both bye together.
 */
function generateFixedCandidate(
  presentPairs: ReadonlyArray<readonly [string, string]>,
  orphans: ReadonlyArray<string>,
  format: RoundFormat,
): GeneratedMatch[] {
  const shuffledPairs   = shuffle([...presentPairs])
  const shuffledOrphans = shuffle([...orphans])

  const matches: GeneratedMatch[] = []
  let court = 1

  // Doubles: two pairs per court.
  for (let i = 0; i < format.doublesCount; i++) {
    const pairA = shuffledPairs[i * 2]
    const pairB = shuffledPairs[i * 2 + 1]
    if (!pairA || !pairB) continue
    matches.push({
      courtNumber:      court++,
      matchType:        'doubles',
      team1Player1Id:   pairA[0],
      team1Player2Id:   pairA[1],
      team2Player1Id:   pairB[0],
      team2Player2Id:   pairB[1],
      singlesPlayer1Id: null,
      singlesPlayer2Id: null,
      byePlayerId:      null,
    })
  }

  // Leftover whole pairs (no court for them this round) → both members bye.
  for (let i = format.doublesCount * 2; i < shuffledPairs.length; i++) {
    const [a, b] = shuffledPairs[i]
    matches.push({
      courtNumber: null, matchType: 'bye',
      team1Player1Id: null, team1Player2Id: null, team2Player1Id: null, team2Player2Id: null,
      singlesPlayer1Id: null, singlesPlayer2Id: null,
      byePlayerId: a,
    })
    matches.push({
      courtNumber: null, matchType: 'bye',
      team1Player1Id: null, team1Player2Id: null, team2Player1Id: null, team2Player2Id: null,
      singlesPlayer1Id: null, singlesPlayer2Id: null,
      byePlayerId: b,
    })
  }

  // Orphans: fill singles court if format reserved one + we have 2+ orphans.
  let orphanIdx = 0
  if (format.singlesCount > 0 && shuffledOrphans.length >= 2) {
    matches.push({
      courtNumber:      court++,
      matchType:        'singles',
      team1Player1Id:   null, team1Player2Id: null, team2Player1Id: null, team2Player2Id: null,
      singlesPlayer1Id: shuffledOrphans[0],
      singlesPlayer2Id: shuffledOrphans[1],
      byePlayerId:      null,
    })
    orphanIdx = 2
  }

  // Remaining orphans → bye.
  for (let i = orphanIdx; i < shuffledOrphans.length; i++) {
    matches.push({
      courtNumber: null, matchType: 'bye',
      team1Player1Id: null, team1Player2Id: null, team2Player1Id: null, team2Player2Id: null,
      singlesPlayer1Id: null, singlesPlayer2Id: null,
      byePlayerId: shuffledOrphans[i],
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

  let hasDoubles = false
  let repeatPartner = false
  let repeatOpponent = false
  let subInSingles = false
  let lateScheduled = false
  let unavoidableBye = false

  for (const m of matches) {
    if (m.matchType === 'doubles') {
      hasDoubles = true
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
      if (p1 && p2 && (history[p1]?.opponents[p2] ?? 0) > 0) repeatOpponent = true
      if (p1 && byId[p1]?.playerType === 'sub') subInSingles = true
      if (p2 && byId[p2]?.playerType === 'sub') subInSingles = true
      for (const id of [p1, p2]) {
        if (id && byId[id]?.arrivedAfterRound != null) lateScheduled = true
      }
    }

    if (m.matchType === 'bye') {
      const pid = m.byePlayerId
      if (pid && (history[pid]?.byes ?? 0) > 0) unavoidableBye = true
    }
  }

  // Partner note only makes sense for doubles rounds.
  if (hasDoubles) {
    if (!repeatPartner)  notes.push('No repeated partners.')
    else                 notes.push('One or more repeated partners — unavoidable with current roster.')
  }

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
  fixedPairs?: ReadonlyMap<string, string>,
  singlesOnly = false,
  mixedDoubles = false,
): GeneratedRound | null {
  const present = players.filter(p => p.actualStatus === 'present')
  if (present.length < 2) return null

  const isFixedMode = fixedPairs != null && fixedPairs.size > 0
  const history     = deriveHistory(completedRounds)

  // Singles-only league: every match is 1v1. Partner concepts (and therefore
  // fixed-partner mode) don't apply, so this branch takes precedence.
  if (singlesOnly) {
    const format = determineRoundFormatSingles(present.length, courts)

    let bestMatches: GeneratedMatch[] | null = null
    let bestScore = -Infinity

    for (let i = 0; i < candidateCount; i++) {
      const matches = generateSinglesCandidate(present, format)
      const score   = scoreCandidate(matches, history, present)
      if (score > bestScore || (score === bestScore && Math.random() < 0.5)) {
        bestScore = score; bestMatches = matches
      }
    }

    if (!bestMatches) return null

    return {
      matches: bestMatches,
      notes:   buildNotes(bestMatches, history, present, format),
      score:   bestScore,
      format,
    }
  }

  // Mixed-doubles (rotating) league: each doubles team must be 1 man + 1 woman.
  // Only applies when partners rotate; fixed-partner pairs are assumed to have
  // been chosen as valid mixed pairs at registration, so they fall through to
  // the fixed-mode branch below.
  if (mixedDoubles && !isFixedMode) {
    const males   = present.filter(p => genderBucket(p.gender) === 'male').length
    const females = present.filter(p => genderBucket(p.gender) === 'female').length
    const others  = present.length - males - females
    const format  = determineRoundFormatMixed(males, females, others, courts)

    let bestMatches: GeneratedMatch[] | null = null
    let bestScore = -Infinity

    for (let i = 0; i < candidateCount; i++) {
      const matches = generateMixedCandidate(present, format)

      // Reject candidates missing required players (e.g. a court left short).
      const valid = matches.every(m => {
        if (m.matchType === 'doubles') return m.team1Player1Id && m.team1Player2Id && m.team2Player1Id && m.team2Player2Id
        if (m.matchType === 'singles') return m.singlesPlayer1Id && m.singlesPlayer2Id
        if (m.matchType === 'bye')     return !!m.byePlayerId
        return false
      })
      if (!valid) continue

      const score = scoreCandidate(matches, history, present)
      if (score > bestScore || (score === bestScore && Math.random() < 0.5)) {
        bestScore = score; bestMatches = matches
      }
    }

    if (!bestMatches) return null

    return {
      matches: bestMatches,
      notes:   buildNotes(bestMatches, history, present, format),
      score:   bestScore,
      format,
    }
  }

  // Fixed mode: format and candidate generation are constrained by which
  // pairs are present today, not by raw player count.
  if (isFixedMode) {
    const { presentPairs, orphans } = resolvePresentPairs(present, fixedPairs)
    const format = determineRoundFormatFixed(presentPairs.length, orphans.length, courts)

    let bestMatches: GeneratedMatch[] | null = null
    let bestScore = -Infinity

    for (let i = 0; i < candidateCount; i++) {
      const matches = generateFixedCandidate(presentPairs, orphans, format)
      const score   = scoreCandidate(matches, history, present)
      if (score > bestScore || (score === bestScore && Math.random() < 0.5)) {
        bestScore = score; bestMatches = matches
      }
    }

    if (!bestMatches) return null

    return {
      matches: bestMatches,
      notes:   buildNotes(bestMatches, history, present, format),
      score:   bestScore,
      format,
    }
  }

  // Rotating mode (default, original behavior).
  const format = determineRoundFormat(present.length, courts)

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
    if (score > bestScore || (score === bestScore && Math.random() < 0.5)) {
      bestScore = score; bestMatches = matches
    }
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
