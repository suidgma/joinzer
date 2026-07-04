// Box assignment engine (Phase 1). Two entry points share one chunking rule:
//   - assignBoxesByRating: sort entrants by rating, then chunk (auto-seed).
//   - chunkBoxes: chunk an already-ordered list as-is (persist a hand-seeded
//     roster without re-sorting).
// Box 1 (tier_rank 1) is the strongest / top of the order. Pure + dependency-free
// so it's unit-testable and usable from both the route and the client.
//
// An entrant is one competitor: a singles player, or a fixed-partner doubles team
// (its canonical registration id, rating = the pair's average).

export type BoxEntrant = { registrationId: string; rating: number | null }
export type AssignedBox = {
  tierRank: number
  members: { registrationId: string; seedInBox: number }[]
}

// Chunk an ordered list of registration ids into tiered boxes, preserving order.
// A trailing lone-player box folds up into the one above it (a box can't run with
// one player).
export function chunkBoxes(orderedRegistrationIds: string[], boxSize: number): AssignedBox[] {
  const size = Math.max(2, Math.floor(boxSize) || 2)

  const boxes: AssignedBox[] = []
  for (let i = 0; i < orderedRegistrationIds.length; i += size) {
    const chunk = orderedRegistrationIds.slice(i, i + size)
    boxes.push({
      tierRank: boxes.length + 1,
      members: chunk.map((id, j) => ({ registrationId: id, seedInBox: j + 1 })),
    })
  }

  if (boxes.length >= 2 && boxes[boxes.length - 1].members.length === 1) {
    const [lone] = boxes.pop()!.members
    const prev = boxes[boxes.length - 1]
    prev.members.push({ registrationId: lone.registrationId, seedInBox: prev.members.length + 1 })
  }

  return boxes
}

export function assignBoxesByRating(entrants: BoxEntrant[], boxSize: number): AssignedBox[] {
  // Rating desc; unrated sort last. Array.sort is stable, so equal ratings keep
  // their incoming order.
  const sorted = [...entrants].sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity))
  return chunkBoxes(sorted.map(e => e.registrationId), boxSize)
}

// Split an ordered list into exactly `numBoxes` tiered boxes, as evenly as
// possible: sizes differ by at most 1, and the first (n % numBoxes) boxes get the
// extra player. Handles odd totals (13 into 3 → 5, 4, 4). Order is preserved (Box
// 1 = top). numBoxes is clamped to [1, n]. This is the box-count model — the
// organizer chooses how many boxes and players auto-fill.
export function distributeIntoBoxes(orderedRegistrationIds: string[], numBoxes: number): AssignedBox[] {
  const n = orderedRegistrationIds.length
  const count = Math.max(1, Math.min(Math.floor(numBoxes) || 1, n || 1))
  const base = Math.floor(n / count)
  const remainder = n % count

  const boxes: AssignedBox[] = []
  let idx = 0
  for (let i = 0; i < count; i++) {
    const size = base + (i < remainder ? 1 : 0)
    boxes.push({
      tierRank: i + 1,
      members: orderedRegistrationIds.slice(idx, idx + size).map((id, j) => ({ registrationId: id, seedInBox: j + 1 })),
    })
    idx += size
  }
  return boxes
}
