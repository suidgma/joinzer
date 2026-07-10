// Serve-first balancing.
//
// In pickleball the side listed first in a match serves first. Across a schedule
// we want that advantage spread evenly — each player/team listed first ~half the
// time. These are the pure primitives every generator (round-robin, box, ladder,
// team, flex, brackets, league sessions) uses to decide the order of a pairing.
//
// The balance is greedy: for each match, list first whoever has served first the
// fewest times so far. Feed the same tally through a whole schedule (or a whole
// season, by seeding it from already-played matches) and it converges to ~50/50.

export type ServeTally = Map<string, number>

/**
 * Order a pairing so the side that has served first the fewest times so far is
 * listed first. `keysOf` maps a side to the id(s) we balance on — one id for
 * singles or a fixed team, or the two player ids for rotating doubles (so each
 * individual, not the ephemeral pair, trends toward 50/50). Ties keep the input
 * order (stable). Mutates `tally` to record the chosen first side.
 */
export function orderByServe<T>(
  a: T,
  b: T,
  keysOf: (side: T) => string[],
  tally: ServeTally,
): [T, T] {
  const load = (side: T) => keysOf(side).reduce((acc, k) => acc + (tally.get(k) ?? 0), 0)
  const aFirst = load(a) <= load(b) // tie → a stays first
  const [first, second] = aFirst ? [a, b] : [b, a]
  for (const k of keysOf(first)) tally.set(k, (tally.get(k) ?? 0) + 1)
  return [first, second]
}

/**
 * Seed a tally from matches already played/scheduled, so round-by-round or
 * season-long generation keeps balancing where it left off. `firstIdsOf` returns
 * the balancing id(s) of whichever side was listed first in a past match.
 */
export function tallyFrom<M>(matches: M[], firstIdsOf: (m: M) => string[]): ServeTally {
  const tally: ServeTally = new Map()
  for (const m of matches) {
    for (const id of firstIdsOf(m)) tally.set(id, (tally.get(id) ?? 0) + 1)
  }
  return tally
}

/**
 * Balance who is listed first across a set of round-robin rounds — each round a
 * list of `[side1, side2]` id pairs for single-id entrants (registration / team /
 * player). Uses one tally across all the rounds passed in.
 */
export function balanceServeOrder(
  rounds: Array<Array<[string, string]>>,
  tally: ServeTally = new Map(),
): Array<Array<[string, string]>> {
  return rounds.map((pairs) =>
    pairs.map(([t1, t2]) => orderByServe(t1, t2, (x) => [x], tally)),
  )
}
