import { timeToMinutes } from './scheduleEstimates'

// Pure helpers for validating division→block assignments in the Schedule Builder.

export type BlockLite = {
  id: string
  block_date: string
  start_time: string
  end_time: string
}

export type AssignmentLite = { division_id: string; block_id: string }

/** Two blocks overlap if they share a date and their time ranges intersect. */
export function blocksOverlap(a: BlockLite, b: BlockLite): boolean {
  if (a.id === b.id) return true
  if (a.block_date !== b.block_date) return false
  return (
    timeToMinutes(a.start_time) < timeToMinutes(b.end_time) &&
    timeToMinutes(b.start_time) < timeToMinutes(a.end_time)
  )
}

export type PlayerConflict = {
  divisionAId: string
  divisionBId: string
  blockAId: string
  blockBId: string
  sharedPlayerIds: string[]
}

/**
 * Players registered in two different divisions whose assigned blocks overlap in
 * time can't physically be in both places. divisionPlayers maps a division id to
 * the user ids registered in it (both partners of a doubles team count).
 */
export function detectPlayerConflicts(
  assignments: AssignmentLite[],
  blocks: BlockLite[],
  divisionPlayers: Record<string, string[]>,
): PlayerConflict[] {
  const blockById = new Map(blocks.map(b => [b.id, b]))
  const conflicts: PlayerConflict[] = []

  for (let i = 0; i < assignments.length; i++) {
    for (let j = i + 1; j < assignments.length; j++) {
      const a = assignments[i]
      const b = assignments[j]
      if (a.division_id === b.division_id) continue

      const blockA = blockById.get(a.block_id)
      const blockB = blockById.get(b.block_id)
      if (!blockA || !blockB || !blocksOverlap(blockA, blockB)) continue

      const playersA = new Set(divisionPlayers[a.division_id] ?? [])
      const shared = (divisionPlayers[b.division_id] ?? []).filter(p => playersA.has(p))
      if (shared.length > 0) {
        conflicts.push({
          divisionAId: a.division_id,
          divisionBId: b.division_id,
          blockAId: a.block_id,
          blockBId: b.block_id,
          sharedPlayerIds: shared,
        })
      }
    }
  }
  return conflicts
}
