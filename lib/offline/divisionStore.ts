import type { LocalMatch } from './applyMutations'
import type { StandingsRegInput } from '../tournament/standings'

// A durable local copy of one division, written while online so the day-of view can read
// (and keep advancing) it with no signal. localStorage is fine for a single division;
// the whole-tournament store (Phase 2) moves to IndexedDB.
export type DivisionSnapshot = {
  divisionId: string
  tournamentId: string
  updatedAt: number   // last local mutation
  hydratedAt: number  // last replaced from the server
  matches: LocalMatch[]
  regs: StandingsRegInput[]
  meta: {
    bracketType: string
    isDoubles: boolean
    pointsToWin: number
    formatSettings: Record<string, unknown>
  }
}

const key = (divisionId: string) => `jz_div_${divisionId}`

export function getSnapshot(divisionId: string): DivisionSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(key(divisionId))
    return raw ? (JSON.parse(raw) as DivisionSnapshot) : null
  } catch {
    return null
  }
}

export function setSnapshot(snap: DivisionSnapshot): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key(snap.divisionId), JSON.stringify(snap))
  } catch {
    // QuotaExceeded / disabled storage — the in-memory working set is still correct.
    console.warn('[divisionStore] snapshot write failed — held in memory only')
  }
}

export function clearSnapshot(divisionId: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(key(divisionId))
  } catch {
    /* ignore */
  }
}
