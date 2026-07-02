// Box assignment engine (Phase 1). Sorts entrants by rating and chunks them into
// tiered boxes: box 1 (tier_rank 1) is the strongest. Pure + dependency-free so
// it's unit-testable; the route resolves entrants/ratings and persists the result.
//
// An entrant is one competitor: a singles player, or a fixed-partner doubles team
// (represented by its canonical registration id, rating = the pair's average).

export type BoxEntrant = { registrationId: string; rating: number | null }
export type AssignedBox = {
  tierRank: number
  members: { registrationId: string; seedInBox: number }[]
}

export function assignBoxesByRating(entrants: BoxEntrant[], boxSize: number): AssignedBox[] {
  const size = Math.max(2, Math.floor(boxSize) || 2)

  // Rating desc; unrated sort last. Array.sort is stable, so equal ratings keep
  // their incoming order (which the caller can pre-order however it likes).
  const sorted = [...entrants].sort((a, b) => (b.rating ?? -Infinity) - (a.rating ?? -Infinity))

  const boxes: AssignedBox[] = []
  for (let i = 0; i < sorted.length; i += size) {
    const chunk = sorted.slice(i, i + size)
    boxes.push({
      tierRank: boxes.length + 1,
      members: chunk.map((e, j) => ({ registrationId: e.registrationId, seedInBox: j + 1 })),
    })
  }

  // A lone-player box can't play — fold a trailing size-1 box up into the one
  // above it (that box just runs one player larger).
  if (boxes.length >= 2 && boxes[boxes.length - 1].members.length === 1) {
    const [lone] = boxes.pop()!.members
    const prev = boxes[boxes.length - 1]
    prev.members.push({ registrationId: lone.registrationId, seedInBox: prev.members.length + 1 })
  }

  return boxes
}
