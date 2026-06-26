import type { MatchRow } from './bracketBuilder'

// Explicit-topology bracket resolver — the single source of truth for single- and
// double-elimination advancement, replacing the old positional/heuristic cascade
// (computeAdvancement + computeLbDrop + checkPendingFeeder + the route's two cascade
// loops). Instead of re-deriving "where does this winner/loser go?" from match_number
// math on every score, we reconstruct the standard bracket's source graph once and
// resolve every slot to a concrete team, a BYE, or PENDING by walking that graph.
//
// Byes and *induced* byes (a WB bye → no loser → the LB match it would have fed
// becomes one-sided → auto-advances → which can itself feed another one-sided LB
// match …) fall out for free: a slot fed by the loser of a bye resolves to BYE, and
// any match that ends up with one real team and one BYE auto-completes. This is what
// makes non-power-of-2 fields (5, 6, 7, 9, 19 …) correct by construction.
//
// `resolveBracket` is idempotent: it returns the mutations needed to bring the
// bracket to its fully-resolved state given current results, and [] once stable.
// `resolveCompletion` applies one freshly-scored result, then resolves.

type Field = 'team_1_registration_id' | 'team_2_registration_id'

export type Mutation =
  | { kind: 'set'; matchId: string; field: Field; value: string }
  | { kind: 'complete'; matchId: string; winner: string }
  | { kind: 'insert'; match: MatchRow }

const FT1: Field = 'team_1_registration_id'
const FT2: Field = 'team_2_registration_id'

// Resolution of a slot: a concrete team id, BYE (the slot will never hold a team),
// or PENDING (its feeder hasn't produced a result yet).
type Resolved = string | null | undefined
const BYE = null
const PENDING = undefined

export function resolveCompletion(completed: MatchRow, allMatches: MatchRow[]): Mutation[] {
  const clone = allMatches.map(m => ({ ...m }))
  const target = clone.find(m => m.id === completed.id)
  if (target) {
    target.status = 'completed'
    target.winner_registration_id = completed.winner_registration_id
  } else {
    clone.push({ ...completed, status: 'completed' })
  }
  return resolveBracket(clone)
}

// Builds the explicit source-graph resolver for an elimination division: memoized
// slot/winner/loser resolution over the standard single-/double-elim topology, plus
// the structural metadata. Shared by resolveBracket (advancement) and
// phantomMatchIds (which padded slots the bracket view should hide) so both speak
// from the same topology instead of re-deriving it with positional heuristics.
function buildResolver(matches: MatchRow[]) {
  const stages = new Set(matches.map(m => m.match_stage))
  const isDouble = stages.has('losers_bracket') || stages.has('championship')
  const isSingle = !isDouble && (stages.has('single_elimination') || stages.has('playoffs') || stages.has('winners_bracket'))

  const wbStage = stages.has('winners_bracket') ? 'winners_bracket'
    : stages.has('single_elimination') ? 'single_elimination'
    : stages.has('playoffs') ? 'playoffs'
    : 'winners_bracket'

  // Group every match by (stage, round), each group sorted by match_number so a
  // match's index within its round is stable — that index is its node id in the graph.
  const groups = new Map<string, MatchRow[]>()
  for (const m of matches) {
    const key = `${m.match_stage}#${m.round_number ?? 1}`
    const arr = groups.get(key)
    if (arr) arr.push(m)
    else groups.set(key, [m])
  }
  for (const arr of groups.values()) arr.sort((a, b) => a.match_number - b.match_number)
  const rowAt = (stage: string, round: number, idx: number): MatchRow | undefined =>
    groups.get(`${stage}#${round}`)?.[idx]
  const maxRound = (stage: string): number => {
    let mx = 0
    for (const m of matches) if (m.match_stage === stage) mx = Math.max(mx, m.round_number ?? 1)
    return mx
  }
  const wbMaxRound = maxRound(wbStage)
  const lbMaxRound = maxRound('losers_bracket')

  // ── Source graph + memoized resolution ─────────────────────────────────────
  const slotMemo = new Map<string, Resolved>()
  const winMemo = new Map<string, Resolved>()
  const loseMemo = new Map<string, Resolved>()

  // Which team belongs in (stage, round, idx)'s slot, per the standard bracket layout.
  function slotTeam(stage: string, round: number, idx: number, side: 't1' | 't2'): Resolved {
    const key = `${stage}#${round}#${idx}#${side}`
    if (slotMemo.has(key)) return slotMemo.get(key)
    slotMemo.set(key, PENDING) // cycle guard (the graph is a DAG, so this never trips)
    const v = computeSlot(stage, round, idx, side)
    slotMemo.set(key, v)
    return v
  }

  function computeSlot(stage: string, round: number, idx: number, side: 't1' | 't2'): Resolved {
    const row = rowAt(stage, round, idx)

    if (stage === wbStage) {
      if (round === 1) {
        if (!row) return BYE
        const stored = side === 't1' ? row.team_1_registration_id : row.team_2_registration_id
        return stored ?? BYE
      }
      // Winners/playoffs round r: each match is fed by two winners of round r-1.
      const feeder = side === 't1' ? 2 * idx : 2 * idx + 1
      return winnerOf(wbStage, round - 1, feeder)
    }

    if (stage === 'losers_bracket') {
      if (round === 1) {
        // LB R1 is fed by the two WB R1 losers.
        const feeder = side === 't1' ? 2 * idx : 2 * idx + 1
        return loserOf(wbStage, 1, feeder)
      }
      if (round % 2 === 0) {
        // Minor (drop-in) round: t1 is the LB survivor, t2 is the dropped WB loser.
        if (side === 't1') return winnerOf('losers_bracket', round - 1, idx)
        const wbRound = round / 2 + 1 // WB round (round/2 + 1) drops into LB round `round`
        return loserOf(wbStage, wbRound, idx)
      }
      // Major round (odd ≥ 3): two LB survivors play each other.
      const feeder = side === 't1' ? 2 * idx : 2 * idx + 1
      return winnerOf('losers_bracket', round - 1, feeder)
    }

    if (stage === 'championship') {
      if (round === 1) {
        if (side === 't1') return winnerOf(wbStage, wbMaxRound, 0)   // undefeated WB champion
        // A round-robin playoff with a double-elim FINAL has a championship but no
        // losers bracket: the final is contested by the two semifinal winners, so
        // team_2 is the second semifinal's winner rather than an LB champion. (For a
        // 2-team playoff there are no semifinals and both teams are seeded directly,
        // so this resolves to a phantom that the diff loop leaves untouched.)
        return lbMaxRound > 0
          ? winnerOf('losers_bracket', lbMaxRound, 0)  // LB champion (one loss)
          : winnerOf(wbStage, wbMaxRound, 1)           // second semifinal winner
      }
      // Round 2 (the reset/decider) carries its teams directly.
      if (!row) return PENDING
      return (side === 't1' ? row.team_1_registration_id : row.team_2_registration_id) ?? PENDING
    }

    return PENDING
  }

  function winnerOf(stage: string, round: number, idx: number): Resolved {
    const key = `${stage}#${round}#${idx}`
    if (winMemo.has(key)) return winMemo.get(key)
    winMemo.set(key, PENDING)
    const v = computeWinner(stage, round, idx)
    winMemo.set(key, v)
    return v
  }
  function computeWinner(stage: string, round: number, idx: number): Resolved {
    const row = rowAt(stage, round, idx)
    if (!row) return BYE
    if (row.status === 'completed' && row.winner_registration_id) return row.winner_registration_id
    const a = slotTeam(stage, round, idx, 't1')
    const b = slotTeam(stage, round, idx, 't2')
    if (a === PENDING || b === PENDING) return PENDING
    if (a != null && b != null) return PENDING // real match, not yet scored
    if (a != null) return a                    // bye
    if (b != null) return b
    return BYE                                  // phantom (both sides BYE)
  }

  function loserOf(stage: string, round: number, idx: number): Resolved {
    const key = `${stage}#${round}#${idx}`
    if (loseMemo.has(key)) return loseMemo.get(key)
    loseMemo.set(key, PENDING)
    const v = computeLoser(stage, round, idx)
    loseMemo.set(key, v)
    return v
  }
  function computeLoser(stage: string, round: number, idx: number): Resolved {
    const row = rowAt(stage, round, idx)
    if (!row) return BYE
    if (row.status === 'completed' && row.winner_registration_id) {
      const w = row.winner_registration_id
      const l = w === row.team_1_registration_id ? row.team_2_registration_id : row.team_1_registration_id
      return l ?? BYE
    }
    const a = slotTeam(stage, round, idx, 't1')
    const b = slotTeam(stage, round, idx, 't2')
    if (a === PENDING || b === PENDING) return PENDING
    if (a != null && b != null) return PENDING // real match — loser unknown until scored
    return BYE                                  // a bye has no loser
  }

  return { isDouble, isSingle, wbStage, groups, rowAt, slotTeam }
}

export function resolveBracket(matches: MatchRow[]): Mutation[] {
  const { isDouble, isSingle, wbStage, groups, rowAt, slotTeam } = buildResolver(matches)
  // Round robin and pool play are fixed schedules — nothing advances.
  if (!isDouble && !isSingle) return []

  // ── Diff current rows against the resolved state ────────────────────────────
  const sets: Mutation[] = []
  const completes: Mutation[] = []
  for (const m of matches) {
    const stage = m.match_stage
    if (stage !== wbStage && stage !== 'losers_bracket' && stage !== 'championship') continue
    const round = m.round_number ?? 1
    const idx = groups.get(`${stage}#${round}`)!.indexOf(m)
    const a = slotTeam(stage, round, idx, 't1')
    const b = slotTeam(stage, round, idx, 't2')
    if (m.team_1_registration_id == null && typeof a === 'string') sets.push({ kind: 'set', matchId: m.id, field: FT1, value: a })
    if (m.team_2_registration_id == null && typeof b === 'string') sets.push({ kind: 'set', matchId: m.id, field: FT2, value: b })
    if (m.status !== 'completed') {
      // Auto-complete only a genuine bye: exactly one real team, the other a definite BYE.
      const byeWin = (typeof a === 'string' && b === BYE) ? a : (typeof b === 'string' && a === BYE) ? b : null
      if (byeWin) completes.push({ kind: 'complete', matchId: m.id, winner: byeWin })
    }
  }

  const muts: Mutation[] = [...sets, ...completes]

  // ── Bracket reset (if-necessary decider) ────────────────────────────────────
  if (isDouble) {
    const champ1 = rowAt('championship', 1, 0)
    if (
      champ1 &&
      champ1.status === 'completed' &&
      champ1.winner_registration_id &&
      champ1.winner_registration_id === champ1.team_2_registration_id && // LB champ won
      !rowAt('championship', 2, 0)
    ) {
      const maxNum = matches.reduce((mx, m) => Math.max(mx, m.match_number ?? 0), 0)
      muts.push({
        kind: 'insert',
        match: {
          id: `reset-${champ1.id}`,
          round_number: 2,
          match_number: maxNum + 1,
          match_stage: 'championship',
          team_1_registration_id: champ1.team_1_registration_id,
          team_2_registration_id: champ1.team_2_registration_id,
          winner_registration_id: null,
          status: 'scheduled',
        },
      })
    }
  }

  return muts
}

// Only these stages can hold padded "phantom" slots (a non-power-of-2 field padded
// up to a bracket). Championship/playoffs/pool/round-robin never do.
const PHANTOM_STAGES = new Set(['winners_bracket', 'losers_bracket', 'single_elimination'])

// Ids of bracket slots that will never hold a real team — padded placeholders the
// bracket view should hide so it doesn't render disconnected "TBD vs TBD" ghosts.
// A slot is phantom when both its sides resolve to BYE through the source graph (or
// it's an empty already-completed bye slot). Using the resolver instead of the old
// positional predecessor heuristic fixes losers-bracket drop-in rounds, whose 1:1
// feeders the heuristic mis-mapped — hiding a real round-2 match while it was TBD.
export function phantomMatchIds(matches: MatchRow[]): Set<string> {
  const out = new Set<string>()
  const { isDouble, isSingle, groups, slotTeam } = buildResolver(matches)
  if (!isDouble && !isSingle) return out

  for (const m of matches) {
    if (!PHANTOM_STAGES.has(m.match_stage)) continue
    if (m.team_1_registration_id || m.team_2_registration_id) continue // has a team — real
    if (m.team_1_source != null || m.team_2_source != null) continue   // placeholder slot — real
    if (m.status === 'completed') { out.add(m.id); continue }          // empty completed = bye slot
    const round = m.round_number ?? 1
    const idx = groups.get(`${m.match_stage}#${round}`)?.indexOf(m) ?? -1
    if (idx === -1) continue
    if (slotTeam(m.match_stage, round, idx, 't1') === BYE && slotTeam(m.match_stage, round, idx, 't2') === BYE) {
      out.add(m.id)
    }
  }
  return out
}
