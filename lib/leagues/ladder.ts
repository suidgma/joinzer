// Ladder League engine — king-of-the-court (up-down) play + bounded ladder
// movement. Pure and dependency-free so it's unit-testable and shared by the
// routes and (where useful) the client.
//
// An "entrant" is one competitor: a singles registration, or a fixed-partner
// doubles team (its canonical registration id). Court 1 is the top court.
// See docs/phases/league-formats.md and the plan for the full design.

export type InitialRankingMethod = 'manual' | 'registration' | 'rating' | 'random'

export type LadderEntrant = {
  registrationId: string
  rating: number | null
  registeredAt: string | null // ISO — used only by the 'registration' method
}

// ── Initial ranking ───────────────────────────────────────────────────────────
// Produce the starting ladder order (position = index + 1) from a method. All
// deterministic (incl. 'random', via a stable id hash) so the setup is testable
// and reproducible; the organizer can still drag to override ('manual').
export function generateInitialRanking(entrants: LadderEntrant[], method: InitialRankingMethod): string[] {
  const list = [...entrants]
  switch (method) {
    case 'rating':
      // Rating desc; unrated last. Stable sort → equal ratings keep input order.
      list.sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity))
      break
    case 'registration':
      // Earliest registration first; unknown timestamps last.
      list.sort((a, b) => registeredMs(a) - registeredMs(b))
      break
    case 'random':
      // Deterministic pseudo-shuffle — a stable hash of the id. Breaks input
      // order without a random source, so results are reproducible in tests.
      list.sort((a, b) => hashId(a.registrationId) - hashId(b.registrationId))
      break
    case 'manual':
    default:
      break // identity — caller supplies the desired (drag-seeded) order
  }
  return list.map((e) => e.registrationId)
}

function registeredMs(e: LadderEntrant): number {
  if (!e.registeredAt) return Number.POSITIVE_INFINITY
  const t = Date.parse(e.registeredAt)
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t
}

function hashId(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ── King-of-the-court rounds ──────────────────────────────────────────────────
export type Court = { court: number; a: string; b: string } // a = top slot, b = bottom slot
export type CourtAssignment = { courts: Court[]; bye: string | null }
export type CourtResult = { court: number; winner: string; loser: string }

// Round 1: seed present entrants (in current ladder order, best first) top-down
// onto courts of two — court 1 = present ranks 1 & 2, court 2 = 3 & 4, … An odd
// count means the lowest-ranked present entrant byes this round.
export function seedKotcRound(presentOrder: string[]): CourtAssignment {
  const ids = [...presentOrder]
  const bye = ids.length % 2 === 1 ? ids.pop()! : null
  const courts: Court[] = []
  for (let i = 0; i + 1 < ids.length; i += 2) {
    courts.push({ court: courts.length + 1, a: ids[i], b: ids[i + 1] })
  }
  return { courts, bye }
}

// Given the previous round's assignment + its results, build the next round via
// up-down: each court's winner moves up a court, its loser moves down; the top
// court's winner and the bottom court's loser hold. Every court keeps exactly two
// entrants. Odd counts use loser-sits rotation: the entrant who would land at the
// very bottom sits out and the returning sitter takes the bottom slot (byes never
// count as games, so win% stays fair).
export function nextKotcRound(prev: CourtAssignment, results: CourtResult[]): CourtAssignment {
  const byCourt = new Map(results.map((r) => [r.court, r]))
  const C = prev.courts.length
  const next: Court[] = []
  for (let k = 1; k <= C; k++) {
    const fromAbove = k === 1 ? byCourt.get(1)!.winner : byCourt.get(k - 1)!.loser
    const fromBelow = k === C ? byCourt.get(C)!.loser : byCourt.get(k + 1)!.winner
    next.push({ court: k, a: fromAbove, b: fromBelow })
  }
  let bye: string | null = null
  if (prev.bye != null && C > 0) {
    bye = next[C - 1].b // the entrant who'd sit at the very bottom now sits out…
    next[C - 1].b = prev.bye // …and the returning sitter re-enters at the bottom
  }
  return { courts: next, bye }
}

// ── Bounded ladder movement ───────────────────────────────────────────────────
// Move the present entrants toward the night's performance order (higher `score`
// = better), but by at most `maxMove` positions each. Odd-even transposition:
// `maxMove` phases, each swapping non-overlapping adjacent pairs when the lower
// one outperformed → every entrant moves ≤ maxMove spots. Conflict-free and
// transparent (climb by out-playing the people next to you). maxMove ≤ 0 = no-op.
export function boundedMovement(presentOrder: string[], score: (id: string) => number, maxMove: number): string[] {
  const arr = [...presentOrder]
  const phases = Math.max(0, Math.floor(maxMove))
  for (let p = 0; p < phases; p++) {
    for (let i = p % 2; i + 1 < arr.length; i += 2) {
      if (score(arr[i + 1]) > score(arr[i])) {
        const t = arr[i]
        arr[i] = arr[i + 1]
        arr[i + 1] = t
      }
    }
  }
  return arr
}

// ── Re-integrate present movement into the full ladder ────────────────────────
// Walk the current full ranking; each PRESENT slot takes the next id from the
// moved present order, each ABSENT slot keeps its occupant. This is what makes
// absent players hold their exact rank with zero position conflicts.
export function reintegrateRanking(currentRanking: string[], present: Set<string>, newPresentOrder: string[]): string[] {
  const result: string[] = []
  let p = 0
  for (const id of currentRanking) {
    result.push(present.has(id) ? newPresentOrder[p++] : id)
  }
  return result
}
