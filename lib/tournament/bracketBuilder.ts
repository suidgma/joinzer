// Pure bracket-building functions — no DB dependencies.
// All functions return plain match row objects ready for insert.

type BaseMatch = Record<string, unknown>

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Next power of 2 >= n */
function nextPow2(n: number): number {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(n, 2))))
}

/** Shuffle array in-place (Fisher-Yates) and return it */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Returns slot positions for standard bracket seeding.
 * bracketPositions(8) = [0,7,3,4,1,6,2,5] so that consecutive pairs are
 * (S1 vs S8), (S4 vs S5), (S2 vs S7), (S3 vs S6) — top two seeds can only
 * meet in the final.
 */
function bracketPositions(n: number): number[] {
  if (n <= 1) return [0]
  const half = bracketPositions(n / 2)
  return half.flatMap(pos => [pos, n - 1 - pos])
}

/**
 * Arranges teams (sorted by seed ascending) into standard bracket seeding
 * order. Teams beyond the array length become null (BYE slots), distributed
 * so top seeds receive byes.
 */
export function arrangeSeedsForBracket(seededTeams: string[]): (string | null)[] {
  const size = nextPow2(seededTeams.length)
  const positions = bracketPositions(size)
  return positions.map(i => (i < seededTeams.length ? seededTeams[i] : null))
}

// ── Single Elimination ────────────────────────────────────────────────────────

/**
 * Generates a complete single-elimination bracket for `teams`.
 * All future-round matches are created with null team slots (TBD).
 * Byes (when team count isn't a power of 2) are auto-completed in Round 1.
 *
 * Returns rows with stage, round_number, match_number (sequential), and
 * team_1/2_registration_id.  match_number is the global counter start value
 * passed in; caller bumps it for subsequent stages.
 */
export function singleEliminationBracket(
  teams: string[],
  stage: 'single_elimination' | 'winners_bracket' | 'playoffs',
  base: BaseMatch,
  startMatchNum = 1,
  skipShuffle = false
): { rows: BaseMatch[]; nextMatchNum: number } {
  // Always lay teams into standard bracket positions so missing slots become
  // distributed byes ("player vs BYE", auto-advanced) instead of clustering at
  // the end as phantom "BYE vs BYE" matches. skipShuffle=true keeps seed order
  // (top seeds get the byes); otherwise we shuffle first for a random draw.
  const seeded: (string | null)[] = arrangeSeedsForBracket(skipShuffle ? teams : shuffle([...teams]))

  const rows: BaseMatch[] = []
  let matchNum = startMatchNum

  // Round 1 — pair seeded slots
  const r1Pairs: [string | null, string | null][] = []
  for (let i = 0; i < seeded.length; i += 2) {
    r1Pairs.push([seeded[i], seeded[i + 1]])
  }

  for (const [t1, t2] of r1Pairs) {
    const isBye = t2 === null
    const row: BaseMatch = {
      ...base,
      match_stage: stage,
      round_number: 1,
      match_number: matchNum++,
      team_1_registration_id: t1,
      team_2_registration_id: t2,  // null only for bye slots; real matches get the actual opponent
    }
    if (isBye && t1) {
      row.status = 'completed'
      row.winner_registration_id = t1
    }
    rows.push(row)
  }

  // Subsequent rounds — TBD placeholders
  let prevCount = r1Pairs.length
  let roundNum = 2
  while (prevCount > 1) {
    const count = Math.ceil(prevCount / 2)
    for (let i = 0; i < count; i++) {
      rows.push({
        ...base,
        match_stage: stage,
        round_number: roundNum,
        match_number: matchNum++,
        team_1_registration_id: null,
        team_2_registration_id: null,
      })
    }
    prevCount = count
    roundNum++
  }

  return { rows, nextMatchNum: matchNum }
}

// ── Double Elimination ────────────────────────────────────────────────────────

/**
 * Generates a complete double-elimination bracket.
 * Returns rows for: winners_bracket, losers_bracket, championship.
 *
 * LB structure for N-team WB:
 *   LB has (2 * log2(N) - 1) rounds alternating between:
 *     - "drop-in" rounds: WB round losers feed in from the top
 *     - "elimination" rounds: LB survivors play each other
 */
export function doubleEliminationBracket(
  teams: string[],
  base: BaseMatch,
  startMatchNum = 1,
  skipShuffle = false
): BaseMatch[] {
  // Distributed byes (see singleEliminationBracket) — no phantom BYE-vs-BYE.
  const seeded: (string | null)[] = arrangeSeedsForBracket(skipShuffle ? teams : shuffle([...teams]))

  const rows: BaseMatch[] = []
  let matchNum = startMatchNum

  // ── Winners bracket ───────────────────────────────────────────────────────
  const r1Pairs: [string | null, string | null][] = []
  for (let i = 0; i < seeded.length; i += 2) {
    r1Pairs.push([seeded[i], seeded[i + 1]])
  }

  for (const [t1, t2] of r1Pairs) {
    const isBye = t2 === null
    const row: BaseMatch = {
      ...base,
      match_stage: 'winners_bracket',
      round_number: 1,
      match_number: matchNum++,
      team_1_registration_id: t1,
      team_2_registration_id: t2,  // null only for bye slots; real matches get the actual opponent
    }
    if (isBye && t1) {
      row.status = 'completed'
      row.winner_registration_id = t1
    }
    rows.push(row)
  }

  // WB subsequent rounds
  let wbPrevCount = r1Pairs.length
  let wbRound = 2
  const wbRoundCounts: number[] = [r1Pairs.length]
  while (wbPrevCount > 1) {
    const count = Math.ceil(wbPrevCount / 2)
    wbRoundCounts.push(count)
    for (let i = 0; i < count; i++) {
      rows.push({
        ...base,
        match_stage: 'winners_bracket',
        round_number: wbRound,
        match_number: matchNum++,
        team_1_registration_id: null,
        team_2_registration_id: null,
      })
    }
    wbPrevCount = count
    wbRound++
  }

  // ── Losers bracket ────────────────────────────────────────────────────────
  // Canonical structure for an N = 2^R bracket (R winners-bracket rounds):
  // 2·(R−1) LB rounds holding N/4, N/4, N/8, N/8, … , 1, 1 matches.
  //   - "minor" rounds (1, and every even round) receive dropped WB losers:
  //       WB round k losers → LB round 1 (k=1) or 2k−2 (k≥2)
  //   - "major" rounds (odd ≥ 3) are LB survivors playing each other
  // Every slot starts TBD; computeLbDrop + computeAdvancement fill them as the
  // bracket plays out. The last LB round's winner is the LB champion, advanced
  // to the Championship by computeChampionshipAdvancement.
  const wbRounds = wbRoundCounts.length
  const bracketSize = wbRoundCounts[0] * 2     // N — power of two
  const totalLbRounds = Math.max(0, 2 * (wbRounds - 1))
  for (let r = 1; r <= totalLbRounds; r++) {
    const count = bracketSize / Math.pow(2, Math.ceil(r / 2) + 1)
    for (let i = 0; i < count; i++) {
      rows.push({
        ...base,
        match_stage: 'losers_bracket',
        round_number: r,
        match_number: matchNum++,
        team_1_registration_id: null,
        team_2_registration_id: null,
      })
    }
  }

  // ── Championship ──────────────────────────────────────────────────────────
  rows.push({
    ...base,
    match_stage: 'championship',
    round_number: 1,
    match_number: matchNum++,
    team_1_registration_id: null,
    team_2_registration_id: null,
  })

  return rows
}

// ── Round Robin ───────────────────────────────────────────────────────────────

/**
 * Circle-method (Berger tables) pairing generator. Pure helper — does not
 * stamp match_stage / pool_number / match_number / row metadata; just returns
 * the [team1, team2] pairs grouped by round.
 *
 *  - Even N → N-1 rounds, N/2 pairs per round.
 *  - Odd  N → N rounds, (N-1)/2 pairs per round (one team gets a bye each round,
 *    which is silently dropped from the output — no "bye match" row produced).
 *
 * Caller controls whether the input order is shuffled first. Round robin
 * (whole-division) shuffles for variety; pool play uses the deterministic
 * snake-distributed pool composition as the seed.
 */
export function circleMethodPairs(teams: string[]): Array<Array<[string, string]>> {
  if (teams.length < 2) return []

  const working: (string | null)[] = [...teams]
  if (working.length % 2 === 1) working.push(null) // bye sentinel

  const n = working.length
  const rounds = n - 1
  const half = n / 2

  // Position 0 stays fixed; positions 1..n-1 rotate one step clockwise each round.
  const slots: (string | null)[] = [...working]
  const out: Array<Array<[string, string]>> = []

  for (let round = 0; round < rounds; round++) {
    const pairs: Array<[string, string]> = []
    for (let i = 0; i < half; i++) {
      const t1 = slots[i]
      const t2 = slots[n - 1 - i]
      if (t1 === null || t2 === null) continue // skip the bye pairing
      pairs.push([t1, t2])
    }
    out.push(pairs)

    // Rotate: [a, b, c, d, e, f] → [a, f, b, c, d, e].
    const last = slots.pop() as string | null
    slots.splice(1, 0, last)
  }

  return out
}

/**
 * Generates a round-robin schedule using the circle method (Berger tables).
 *
 * Every team plays every other team exactly once, distributed across rounds
 * where no team appears more than once per round. This is what makes a true
 * round-robin tournament schedulable on a fixed court count — each round can
 * run in parallel because the matches share no players.
 *
 * The `teams` order is shuffled first so the same registration set doesn't
 * always produce the same matchups in round 1.
 */
export function roundRobinMatches(
  teams: string[],
  base: BaseMatch,
  startMatchNum = 1
): { rows: BaseMatch[]; nextMatchNum: number } {
  if (teams.length < 2) return { rows: [], nextMatchNum: startMatchNum }

  // Shuffle so round 1 isn't always the same pairings for the same input set.
  const pairsByRound = circleMethodPairs(shuffle([...teams]))

  const rows: BaseMatch[] = []
  let matchNum = startMatchNum

  pairsByRound.forEach((pairs, idx) => {
    const round = idx + 1
    for (const [t1, t2] of pairs) {
      rows.push({
        ...base,
        team_1_registration_id: t1,
        team_2_registration_id: t2,
        match_stage: 'round_robin',
        round_number: round,
        match_number: matchNum++,
      })
    }
  })

  return { rows, nextMatchNum: matchNum }
}

// ── Rotating Doubles Round Robin ──────────────────────────────────────────────

/**
 * Generates a round-robin schedule where players rotate partners every round.
 *
 * Used by tournament divisions where partner_mode='rotating'. Players sign up
 * solo (one registration per player). Each round, players are reshuffled
 * into 4-person matches with new partner/opponent combinations, preferring
 * unique partnerships across the tournament.
 *
 * Inputs:
 *   - playerIds: solo registration IDs (one per player)
 *   - rounds: how many rounds to generate. Defaults to playerIds.length - 1
 *     for even counts (one round per teammate slot), playerIds.length for odd.
 *   - courts: max parallel matches per round. Default unlimited.
 *
 * Each generated match row uses:
 *   team_1_registration_id          → side A player 1
 *   team_1_partner_registration_id  → side A player 2
 *   team_2_registration_id          → side B player 1
 *   team_2_partner_registration_id  → side B player 2
 *
 * The algorithm is a simplified greedy: shuffle players, pair them into
 * 4-player groups, optionally re-roll the round if it has too many repeat
 * partners vs prior rounds. Not optimal — but fast and produces good variety
 * for typical 8-16 player divisions.
 */
export function rotatingDoublesMatches(
  playerIds: string[],
  base: BaseMatch,
  options: { rounds?: number; courts?: number; startMatchNum?: number } = {}
): { rows: BaseMatch[]; nextMatchNum: number } {
  const startMatchNum = options.startMatchNum ?? 1
  if (playerIds.length < 4) return { rows: [], nextMatchNum: startMatchNum }

  // Doubles needs multiples of 4. With N not divisible by 4, the remainder
  // sits out each round (they get reshuffled in via the per-round shuffle).
  const playersPerRound = Math.floor(playerIds.length / 4) * 4
  if (playersPerRound < 4) return { rows: [], nextMatchNum: startMatchNum }

  const matchesPerRound = playersPerRound / 4
  const maxCourts = options.courts ?? matchesPerRound
  const actualMatchesPerRound = Math.min(matchesPerRound, maxCourts)

  const totalRounds = options.rounds ?? (playerIds.length % 2 === 0 ? playerIds.length - 1 : playerIds.length)

  // Track partner frequency to discourage repeats round-over-round.
  const partnerCount = new Map<string, number>()
  const partnerKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`

  const rows: BaseMatch[] = []
  let matchNum = startMatchNum

  for (let round = 1; round <= totalRounds; round++) {
    // Try a handful of shuffles and pick the one with the fewest repeat partnerships.
    let bestShuffle: string[] | null = null
    let bestRepeats = Infinity

    for (let attempt = 0; attempt < 30; attempt++) {
      const shuffled = shuffle([...playerIds])
      let repeats = 0
      for (let i = 0; i < actualMatchesPerRound * 4; i += 4) {
        const [p1, p2, p3, p4] = shuffled.slice(i, i + 4)
        repeats += partnerCount.get(partnerKey(p1, p2)) ?? 0
        repeats += partnerCount.get(partnerKey(p3, p4)) ?? 0
      }
      if (repeats < bestRepeats) {
        bestRepeats = repeats
        bestShuffle = shuffled
        if (repeats === 0) break // perfect round, stop searching
      }
    }

    const chosen = bestShuffle ?? shuffle([...playerIds])

    for (let i = 0; i < actualMatchesPerRound; i++) {
      const [p1, p2, p3, p4] = chosen.slice(i * 4, i * 4 + 4)
      rows.push({
        ...base,
        team_1_registration_id:         p1,
        team_1_partner_registration_id: p2,
        team_2_registration_id:         p3,
        team_2_partner_registration_id: p4,
        match_stage: 'round_robin',
        round_number: round,
        match_number: matchNum++,
      })
      // Record the partnerships used so the next round's shuffles can avoid them.
      partnerCount.set(partnerKey(p1, p2), (partnerCount.get(partnerKey(p1, p2)) ?? 0) + 1)
      partnerCount.set(partnerKey(p3, p4), (partnerCount.get(partnerKey(p3, p4)) ?? 0) + 1)
    }
  }

  return { rows, nextMatchNum: matchNum }
}

// ── Pool Play ─────────────────────────────────────────────────────────────────

/**
 * Generates pool play matches with proper round numbering inside each pool.
 *
 * Pool composition: a team with an explicit `assignments` entry goes into that
 * pool; everyone else is dealt alternately across the pools in the given order
 * (seed order, else registration order), and unassigned teams fill the smallest
 * pool first so pools stay balanced. Within each pool the circle method produces
 * rounds where no team plays twice. Pools share the same `round_number` so the
 * schedule packer can run pool 1's round 1 alongside pool 2's round 1 (different
 * pools never share players).
 */
export function poolPlayMatches(
  teams: string[],
  numPools: number,
  base: BaseMatch,
  startMatchNum = 1,
  assignments?: Map<string, number>   // team registration id → 1-based pool number
): { rows: BaseMatch[]; nextMatchNum: number } {
  const np = Math.max(1, numPools)
  const pools: string[][] = Array.from({ length: np }, () => [])

  if (assignments && teams.some(t => assignments.get(t) != null)) {
    const unassigned: string[] = []
    for (const t of teams) {
      const p = assignments.get(t)
      if (p != null && p >= 1 && p <= np) pools[p - 1].push(t)
      else unassigned.push(t)
    }
    // Balance the leftovers: each goes into whichever pool is currently smallest.
    for (const t of unassigned) {
      let min = 0
      for (let i = 1; i < np; i++) if (pools[i].length < pools[min].length) min = i
      pools[min].push(t)
    }
  } else {
    teams.forEach((t, i) => pools[i % np].push(t))
  }

  const rows: BaseMatch[] = []
  let matchNum = startMatchNum

  pools.forEach((pool, pi) => {
    // Pool composition is the deterministic seed — no shuffle inside the pool.
    const pairsByRound = circleMethodPairs(pool)
    pairsByRound.forEach((pairs, idx) => {
      const round = idx + 1
      for (const [t1, t2] of pairs) {
        rows.push({
          ...base,
          team_1_registration_id: t1,
          team_2_registration_id: t2,
          match_stage: 'pool_play',
          pool_number: pi + 1,
          round_number: round,
          match_number: matchNum++,
        })
      }
    })
  })

  return { rows, nextMatchNum: matchNum }
}

/**
 * Builds the playoff bracket for `seededTeams` (already ordered best→worst by
 * standings — seed 1 first). The bracket is single-elimination; `finalFormat`
 * controls only the FINAL:
 *   - 'single_elimination' → the final is one match.
 *   - 'double_elimination' → an "if-necessary" final: the better-seeded finalist
 *     (championship team_1) needs one win; the challenger (team_2) must win twice.
 *     The decider (championship round 2) is created on demand by computeBracketReset;
 *     the championship's two teams are resolved from the semifinal winners by
 *     resolveCompletion (it special-cases a championship with no losers bracket).
 *
 * Non-powers-of-two (6) get distributed byes via arrangeSeedsForBracket (top seeds
 * bye). skipShuffle keeps the standings order.
 */
export function playoffBracket(
  seededTeams: string[],
  finalFormat: 'single_elimination' | 'double_elimination',
  base: BaseMatch,
  startMatchNum = 1
): { rows: BaseMatch[]; nextMatchNum: number } {
  if (seededTeams.length < 2) return { rows: [], nextMatchNum: startMatchNum }

  const { rows, nextMatchNum } = singleEliminationBracket(seededTeams, 'playoffs', base, startMatchNum, true)
  if (finalFormat !== 'double_elimination') return { rows, nextMatchNum }

  // Convert the final (the last single-elim round, one match) into a championship
  // round-1 match. For 2 qualifiers there are no semifinals to feed it, so the two
  // finalists are seeded directly; otherwise the semifinal winners fill it.
  const playoffRoundNums = rows
    .filter(r => r.match_stage === 'playoffs')
    .map(r => r.round_number as number)
  const maxRound = Math.max(...playoffRoundNums)
  const finalMatch = rows.find(r => r.match_stage === 'playoffs' && r.round_number === maxRound)
  if (finalMatch) {
    finalMatch.match_stage = 'championship'
    finalMatch.round_number = 1
    if (maxRound === 1) {
      finalMatch.team_1_registration_id = seededTeams[0] ?? null
      finalMatch.team_2_registration_id = seededTeams[1] ?? null
    }
  }
  return { rows, nextMatchNum }
}

// ── Advancement helpers ───────────────────────────────────────────────────────

export type MatchRow = {
  id: string
  round_number: number | null
  match_number: number
  match_stage: string
  team_1_registration_id: string | null
  team_2_registration_id: string | null
  winner_registration_id?: string | null
  status?: string
  // Position placeholders for not-yet-seeded playoff slots — present means the slot
  // is real (it will hold a standings-position team), not a phantom padded bye.
  team_1_source?: unknown
  team_2_source?: unknown
}

/**
 * Given a completed match and all matches in the division,
 * returns the DB update needed to advance the winner to the next round.
 * Returns null if this is the final match or no next match found.
 */
export function computeAdvancement(
  completedMatch: MatchRow,
  allMatches: MatchRow[]
): { matchId: string; field: 'team_1_registration_id' | 'team_2_registration_id'; value: string } | null {
  const winner = completedMatch.winner_registration_id
  if (!winner) return null

  const stage = completedMatch.match_stage

  // Round robin and pool play schedules are fixed up front — winners never
  // advance into later rounds. Without this guard, scoring a round-N match
  // overwrites the pre-assigned teams of round N+1, corrupting the schedule.
  if (stage === 'round_robin' || stage === 'pool_play') return null

  const roundNum = completedMatch.round_number ?? 1

  // Matches in the same stage and same round, sorted by match_number
  const sameRound = allMatches
    .filter(m => m.match_stage === stage && m.round_number === roundNum)
    .sort((a, b) => a.match_number - b.match_number)

  const posInRound = sameRound.findIndex(m => m.id === completedMatch.id)
  if (posInRound === -1) return null

  const nextRound = allMatches
    .filter(m => m.match_stage === stage && m.round_number === roundNum + 1)
    .sort((a, b) => a.match_number - b.match_number)

  if (nextRound.length === 0) return null

  // Within the losers bracket, advancement alternates. Into a "major" round
  // (odd ≥ 3 — LB survivors play each other) winners pair up; into a "minor"
  // round (where a dropped WB loser fills team_2) each survivor takes its own
  // match as team_1. Everywhere else (WB, playoffs) it's the standard pairing.
  const nextRoundNum = roundNum + 1
  const lbMinorNext = stage === 'losers_bracket' && !(nextRoundNum % 2 === 1 && nextRoundNum >= 3)
  const nextMatchIdx = lbMinorNext ? posInRound : Math.floor(posInRound / 2)
  const nextMatch = nextRound[nextMatchIdx]
  if (!nextMatch) return null

  const field = lbMinorNext
    ? 'team_1_registration_id'
    : (posInRound % 2 === 0 ? 'team_1_registration_id' : 'team_2_registration_id')
  return { matchId: nextMatch.id, field, value: winner }
}

// Returns true if a match will eventually have real players — it already has at least
// one team, or one of its same-stage predecessor matches is real (not phantom/padded).
// Distinguishes "temporarily null-null, waiting for upstream results" from
// "phantom null-null, a padded bracket slot that will never have players".
export function matchWillBeReal(match: MatchRow, allMatches: MatchRow[], depth = 0): boolean {
  if (depth > 6) return false
  if (match.team_1_registration_id || match.team_2_registration_id) return true
  const round = match.round_number ?? 1
  if (round <= 1) return false  // R1 null-null with no teams = phantom
  const sameRound = allMatches
    .filter(m => m.match_stage === match.match_stage && m.round_number === round)
    .sort((a, b) => a.match_number - b.match_number)
  const idx = sameRound.findIndex(m => m.id === match.id)
  if (idx === -1) return false
  const prevRound = allMatches
    .filter(m => m.match_stage === match.match_stage && m.round_number === round - 1)
    .sort((a, b) => a.match_number - b.match_number)
  const f1 = prevRound[idx * 2]
  const f2 = prevRound[idx * 2 + 1]
  return (
    (f1 != null && matchWillBeReal(f1, allMatches, depth + 1)) ||
    (f2 != null && matchWillBeReal(f2, allMatches, depth + 1))
  )
}

// Returns true if the empty slot of nextMatch will eventually be filled by a real pending match.
// Checks both same-stage feeders AND WB drop-in feeders for LB drop-in rounds.
export function checkPendingFeeder(
  nextMatch: { id: string; match_stage: string; round_number: number | null },
  otherField: 'team_1_registration_id' | 'team_2_registration_id',
  currentCompleted: MatchRow,
  allDivMatches: MatchRow[],
): boolean {
  // Championship always waits — its two participants come from different stages
  // (WB Final winner and LB Final winner). Never treat it as an induced BYE.
  if (nextMatch.match_stage === 'championship') return true

  // Same-stage feeder: a pending match in the same stage/round that advances here.
  const hasSameStageFeeder = allDivMatches.some(m => {
    if (m.match_stage !== currentCompleted.match_stage) return false
    if (m.round_number !== currentCompleted.round_number) return false
    if (m.status === 'completed') return false
    if (m.id === currentCompleted.id) return false
    // A still-empty (null-null) sibling is a REAL pending feeder when it will
    // eventually have players — it's waiting on its own upstream results, not a
    // phantom padded slot. Skipping it (the old behavior) made scoring one half of
    // the bracket down to a match auto-complete it as an induced BYE while the
    // other feeder was still resolving — e.g. the final "winning" before the
    // second semifinal is even played.
    const hasTeam = !!(m.team_1_registration_id || m.team_2_registration_id)
    if (!hasTeam && !matchWillBeReal(m, allDivMatches)) return false
    // Sentinel winner lets computeAdvancement resolve the target slot by position
    // even when the feeder has no team yet (we compare only matchId + field).
    const sentinel = m.team_1_registration_id ?? m.team_2_registration_id ?? '__pending__'
    const adv = computeAdvancement(
      { ...m, winner_registration_id: sentinel, status: 'completed' },
      allDivMatches
    )
    return adv?.matchId === nextMatch.id && adv?.field === otherField
  })
  if (hasSameStageFeeder) return true

  // For LB drop-in rounds (odd round numbers), also check if a pending WB match
  // will eventually drop a loser into the empty slot.
  // Use positional math (not computeLbDrop) so null-null WB matches that are
  // "waiting for their own WB R1 feeders" still count as real pending feeders.
  if (nextMatch.match_stage === 'losers_bracket') {
    const lbRound = nextMatch.round_number ?? 1
    // Minor (drop-in) LB rounds are round 1 and the even rounds; WB round k
    // drops into LB round 1 (k=1) or 2k-2 (k>=2).
    if (lbRound === 1 || lbRound % 2 === 0) {
      const expectedWbRound = lbRound === 1 ? 1 : lbRound / 2 + 1
      const wbRoundMatches = allDivMatches
        .filter(m => m.match_stage === 'winners_bracket' && m.round_number === expectedWbRound)
        .sort((a, b) => a.match_number - b.match_number)
      const lbTargetRound = expectedWbRound === 1 ? 1 : expectedWbRound * 2 - 2
      const lbTargetMatches = allDivMatches
        .filter(m => m.match_stage === 'losers_bracket' && m.round_number === lbTargetRound)
        .sort((a, b) => a.match_number - b.match_number)
      return wbRoundMatches.some((wbM, wbIdx) => {
        if (wbM.status === 'completed') return false
        // Determine which LB slot this WB match's loser would drop into, by position
        let lbMatchIdx: number
        let lbField: 'team_1_registration_id' | 'team_2_registration_id'
        if (expectedWbRound === 1) {
          lbMatchIdx = Math.floor(wbIdx / 2)
          lbField = wbIdx % 2 === 0 ? 'team_1_registration_id' : 'team_2_registration_id'
        } else {
          lbMatchIdx = wbIdx
          lbField = 'team_2_registration_id'
        }
        const targetLbMatch = lbTargetMatches[lbMatchIdx]
        if (!targetLbMatch || targetLbMatch.id !== nextMatch.id || lbField !== otherField) {
          return false
        }
        // Correct drop target — only count if the WB match is real (not a phantom padded slot)
        return matchWillBeReal(wbM, allDivMatches)
      })
    }
  }

  return false
}

/**
 * For double elimination, the WB Final winner and LB Final winner both need to
 * advance to the Championship match. computeAdvancement only moves within the
 * same stage, so we handle the cross-stage hop here.
 *
 * Returns the DB update to place the WB/LB champion into the Championship, or
 * null if there is no championship match or the given match isn't the stage final.
 */
export function computeChampionshipAdvancement(
  completedMatch: MatchRow,
  allMatches: MatchRow[]
): { matchId: string; field: 'team_1_registration_id' | 'team_2_registration_id'; value: string } | null {
  const winner = completedMatch.winner_registration_id
  if (!winner) return null

  const stage = completedMatch.match_stage
  if (stage !== 'winners_bracket' && stage !== 'losers_bracket') return null

  const championship = allMatches.find(m => m.match_stage === 'championship')
  if (!championship) return null

  // Only the last round of this stage advances to the Championship
  const stageMatches = allMatches.filter(m => m.match_stage === stage)
  const maxRound = Math.max(...stageMatches.map(m => m.round_number ?? 1))
  if ((completedMatch.round_number ?? 1) !== maxRound) return null

  // WB champion → team_1 (they come in undefeated)
  // LB champion → team_2 (they have one loss)
  const field = stage === 'winners_bracket' ? 'team_1_registration_id' : 'team_2_registration_id'
  return { matchId: championship.id, field, value: winner }
}

export type ResetMatch = {
  match_stage: 'championship'
  round_number: 2
  match_number: number
  team_1_registration_id: string | null
  team_2_registration_id: string | null
  status: 'scheduled'
}

/**
 * Double-elimination bracket reset (the "if-necessary" decider).
 *
 * The Championship pits the winners-bracket champion (team_1, 0 losses) against
 * the losers-bracket champion (team_2, 1 loss). If the WB champ wins, the title
 * is decided. If the LB champ wins, BOTH teams now have one loss, so a second
 * Championship match (round 2) must be played to decide it fairly — the WB champ
 * has earned that rematch by going undefeated.
 *
 * Returns the reset match row to insert, or null when no reset is needed: the
 * WB champ won, the completed match isn't the first Championship, or a reset
 * already exists (idempotent — safe to call on any championship completion).
 */
export function computeBracketReset(completed: MatchRow, allMatches: MatchRow[]): ResetMatch | null {
  if (completed.match_stage !== 'championship') return null
  if ((completed.round_number ?? 1) !== 1) return null
  const winner = completed.winner_registration_id
  if (!winner) return null
  // Reset only when the losers-bracket champion (team_2) wins the first final.
  if (winner !== completed.team_2_registration_id) return null
  // Never create a second reset.
  if (allMatches.some(m => m.match_stage === 'championship' && (m.round_number ?? 1) === 2)) return null

  const maxMatchNum = allMatches.reduce((mx, m) => Math.max(mx, m.match_number ?? 0), 0)
  return {
    match_stage: 'championship',
    round_number: 2,
    match_number: maxMatchNum + 1,
    team_1_registration_id: completed.team_1_registration_id,   // WB champ
    team_2_registration_id: completed.team_2_registration_id,   // LB champ
    status: 'scheduled',
  }
}

/**
 * Given a completed WB match, returns the DB update to drop the LOSER into the
 * correct Losers Bracket slot.
 *
 * WB round N losers drop into LB round (N===1 ? 1 : 2N-2):
 *   - WB R1 → LB R1: pairs of 2 WB losers share one LB match
 *   - WB R2 → LB R2: each WB loser takes one LB match slot as team_2
 *   - WB R3 → LB R4, WB R4 → LB R6: same pattern (the WB-final loser lands in
 *     the last LB round — its decider)
 *
 * Returns null for BYE matches (no loser), non-WB matches, or when no matching
 * LB slot exists.
 */
export function computeLbDrop(
  completedMatch: MatchRow,
  allMatches: MatchRow[]
): { matchId: string; field: 'team_1_registration_id' | 'team_2_registration_id'; value: string } | null {
  if (completedMatch.match_stage !== 'winners_bracket') return null

  const winner = completedMatch.winner_registration_id
  if (!winner) return null

  // BYE match — no loser
  const loser = winner === completedMatch.team_1_registration_id
    ? completedMatch.team_2_registration_id
    : completedMatch.team_1_registration_id
  if (!loser) return null

  const wbRound = completedMatch.round_number ?? 1

  // WB R1 → LB R1; WB RN → LB R(2N-2). The WB-final loser lands in the last LB round.
  const lbTargetRound = wbRound === 1 ? 1 : wbRound * 2 - 2

  const sameWbRound = allMatches
    .filter(m => m.match_stage === 'winners_bracket' && m.round_number === wbRound)
    .sort((a, b) => a.match_number - b.match_number)

  const posInWbRound = sameWbRound.findIndex(m => m.id === completedMatch.id)
  if (posInWbRound === -1) return null

  const lbTargetMatches = allMatches
    .filter(m => m.match_stage === 'losers_bracket' && m.round_number === lbTargetRound)
    .sort((a, b) => a.match_number - b.match_number)

  if (lbTargetMatches.length === 0) return null

  let lbMatchIdx: number
  let lbField: 'team_1_registration_id' | 'team_2_registration_id'

  if (wbRound === 1) {
    // Pair WB R1 losers together: positions 0&1 → LB match 0, 2&3 → LB match 1, etc.
    lbMatchIdx = Math.floor(posInWbRound / 2)
    lbField = posInWbRound % 2 === 0 ? 'team_1_registration_id' : 'team_2_registration_id'
  } else {
    // One WB loser per LB match, as team_2 (LB survivor fills team_1 via advancement)
    lbMatchIdx = posInWbRound
    lbField = 'team_2_registration_id'
  }

  const targetLbMatch = lbTargetMatches[lbMatchIdx]
  if (!targetLbMatch) return null

  return { matchId: targetLbMatch.id, field: lbField, value: loser }
}
