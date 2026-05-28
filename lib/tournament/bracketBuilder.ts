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
  startMatchNum = 1
): { rows: BaseMatch[]; nextMatchNum: number } {
  const shuffled = shuffle([...teams])
  const size = nextPow2(shuffled.length)

  // Pad with nulls for byes
  const seeded: (string | null)[] = [
    ...shuffled,
    ...Array(size - shuffled.length).fill(null),
  ]

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
      team_2_registration_id: null, // byes always have null t2
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
  startMatchNum = 1
): BaseMatch[] {
  const shuffled = shuffle([...teams])
  const size = nextPow2(shuffled.length)
  const seeded: (string | null)[] = [
    ...shuffled,
    ...Array(size - shuffled.length).fill(null),
  ]

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
      team_2_registration_id: null,
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
  // Number of LB rounds = 2 * (number of WB rounds - 1)
  // Rounds alternate: drop-in (WB losers feed in) and elimination
  const wbRounds = wbRoundCounts.length
  let lbSurvivors = 0 // grows as we progress
  let lbRound = 1

  for (let wbR = 1; wbR <= wbRounds - 1; wbR++) {
    const wbLosersCount = wbRoundCounts[wbR - 1] // losers from WB round wbR

    // Drop-in round: WB losers pair against LB survivors
    const dropInCount = wbR === 1
      ? Math.floor(wbLosersCount / 2) // first LB round: pair WB R1 losers together
      : Math.min(wbLosersCount, lbSurvivors)    // later: WB losers vs LB survivors

    const dropInMatches = wbR === 1
      ? Math.floor(wbLosersCount / 2)
      : wbLosersCount // one match per WB loser feeding into LB

    const dropInCount2 = wbR === 1
      ? Math.floor(wbLosersCount / 2)
      : wbLosersCount

    for (let i = 0; i < dropInCount2; i++) {
      rows.push({
        ...base,
        match_stage: 'losers_bracket',
        round_number: lbRound,
        match_number: matchNum++,
        team_1_registration_id: null,
        team_2_registration_id: null,
      })
    }
    lbSurvivors = dropInCount2
    lbRound++

    // Elimination round: LB survivors play each other
    if (lbSurvivors > 1) {
      const elimCount = Math.ceil(lbSurvivors / 2)
      for (let i = 0; i < elimCount; i++) {
        rows.push({
          ...base,
          match_stage: 'losers_bracket',
          round_number: lbRound,
          match_number: matchNum++,
          team_1_registration_id: null,
          team_2_registration_id: null,
        })
      }
      lbSurvivors = elimCount
      lbRound++
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
function circleMethodPairs(teams: string[]): Array<Array<[string, string]>> {
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

// ── Pool Play ─────────────────────────────────────────────────────────────────

/**
 * Generates pool play matches with proper round numbering inside each pool.
 *
 * Teams are snake-distributed across pools (registration order seeds pool
 * composition). Within each pool, the circle method produces rounds where
 * no team plays twice. Pools share the same `round_number` so the schedule
 * packer can place pool 1's round 1 alongside pool 2's round 1 in the same
 * wave (different pools never share players).
 */
export function poolPlayMatches(
  teams: string[],
  numPools: number,
  base: BaseMatch,
  startMatchNum = 1
): { rows: BaseMatch[]; nextMatchNum: number } {
  const pools: string[][] = Array.from({ length: Math.max(1, numPools) }, () => [])
  teams.forEach((t, i) => pools[i % pools.length].push(t))

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
 * Builds playoff bracket from pool standings.
 * advancingTeams: ordered list of team IDs (already ranked by pool standings).
 */
export function playoffBracket(
  advancingTeams: string[],
  playoffFormat: 'single_elimination' | 'double_elimination',
  base: BaseMatch,
  startMatchNum = 1
): BaseMatch[] {
  if (playoffFormat === 'double_elimination') {
    return doubleEliminationBracket(advancingTeams, base, startMatchNum)
  }
  return singleEliminationBracket(advancingTeams, 'playoffs', base, startMatchNum).rows
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

  const nextMatchIdx = Math.floor(posInRound / 2)
  const nextMatch = nextRound[nextMatchIdx]
  if (!nextMatch) return null

  const field = posInRound % 2 === 0 ? 'team_1_registration_id' : 'team_2_registration_id'
  return { matchId: nextMatch.id, field, value: winner }
}
