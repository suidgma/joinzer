// Promotion / relegation between box cycles (Phase 1). Given each box's final
// standings (best → worst), the top `promoteCount` of each box move up a tier and
// the bottom `relegateCount` move down a tier (the top box can't promote, the
// bottom box can't relegate). Produces the next cycle's boxes. Pure + testable.
//
// Within each new box the order is: players promoted in (they earned the top),
// then the stayers by their standing, then players relegated in (near the bottom).

export type StandingBox = { tierRank: number; memberIds: string[] } // best → worst
export type NextBox = { tierRank: number; memberIds: string[] }      // seed order

export function applyPromotionRelegation(
  boxes: StandingBox[],
  promoteCount: number,
  relegateCount: number,
): NextBox[] {
  const numBoxes = boxes.length
  const promote = Math.max(0, Math.floor(promoteCount || 0))
  const relegate = Math.max(0, Math.floor(relegateCount || 0))

  // cat: 0 = promoted in, 1 = stayed, 2 = relegated in
  type Mover = { regId: string; newTier: number; cat: 0 | 1 | 2; oldRank: number }
  const movers: Mover[] = []

  for (const box of boxes) {
    const size = box.memberIds.length
    box.memberIds.forEach((regId, rank) => {
      let newTier = box.tierRank
      let cat: 0 | 1 | 2 = 1
      if (rank < promote && box.tierRank > 1) {
        newTier = box.tierRank - 1; cat = 0            // promoted up
      } else if (rank >= size - relegate && box.tierRank < numBoxes) {
        newTier = box.tierRank + 1; cat = 2            // relegated down
      }
      movers.push({ regId, newTier, cat, oldRank: rank })
    })
  }

  const byTier = new Map<number, Mover[]>()
  for (const m of movers) {
    if (!byTier.has(m.newTier)) byTier.set(m.newTier, [])
    byTier.get(m.newTier)!.push(m)
  }

  const result: NextBox[] = []
  for (let tier = 1; tier <= numBoxes; tier++) {
    const ms = (byTier.get(tier) ?? []).sort((a, b) => a.cat - b.cat || a.oldRank - b.oldRank)
    result.push({ tierRank: tier, memberIds: ms.map(m => m.regId) })
  }
  return result
}
