import type { LocalMatch } from './applyMutations'

// Durable IndexedDB copy of a whole tournament, for Phase-2 offline run mode. localStorage
// (used per-division in Phase 1) is too small for a full event, so the day-of data lives
// here. Records keep the server rows' own `tournament_id` / `division_id` so a whole
// tournament round-trips by index. See docs/phases/offline-run-mode-phase-2.md.

const DB_NAME = 'joinzer-offline'
// v2 adds the `outbox` store (Phase-2 step 4). It lives in the same DB but OUTSIDE `STORES`,
// so tournament read/write/clear transactions never touch it — pending writes survive a re-hydrate.
const DB_VERSION = 2
const STORES = ['tournaments', 'divisions', 'registrations', 'courts', 'matches'] as const
export const OUTBOX_STORE = 'outbox'
type StoreName = (typeof STORES)[number]

type Row = { id: string; [k: string]: unknown }
export type StoredMatch = LocalMatch & { tournament_id: string; division_id: string }

export type TournamentBundle = {
  tournament: Row
  divisions: Array<Row & { tournament_id: string }>
  registrations: Array<Row & { tournament_id: string; division_id: string }>
  courts: Array<Row & { tournament_id: string }>
  matches: StoredMatch[]
}

const idbAvailable = () => typeof indexedDB !== 'undefined'

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('tournaments')) db.createObjectStore('tournaments', { keyPath: 'id' })
      for (const s of ['divisions', 'registrations', 'courts', 'matches'] as const) {
        if (db.objectStoreNames.contains(s)) continue
        const store = db.createObjectStore(s, { keyPath: 'id' })
        store.createIndex('tournament_id', 'tournament_id', { unique: false })
        if (s === 'registrations' || s === 'matches') store.createIndex('division_id', 'division_id', { unique: false })
      }
      // Unified outbox for run-mode writes (check-in / resolve / reschedule). FIFO by auto `seq`.
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) db.createObjectStore(OUTBOX_STORE, { keyPath: 'seq', autoIncrement: true })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// Resolve when a transaction finishes — the point at which every request it holds is done.
export function txDone(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

const range = (v: string) => IDBKeyRange.only(v)

// Delete every row for a tournament (its own row + all indexed children) in one tx.
async function clearInternal(db: IDBDatabase, tournamentId: string): Promise<void> {
  const t = db.transaction([...STORES], 'readwrite')
  t.objectStore('tournaments').delete(tournamentId)
  for (const s of ['divisions', 'registrations', 'courts', 'matches'] as const) {
    const idx = t.objectStore(s).index('tournament_id')
    const cur = idx.openKeyCursor(range(tournamentId))
    cur.onsuccess = () => {
      const c = cur.result
      if (c) { t.objectStore(s).delete(c.primaryKey); c.continue() }
    }
  }
  await txDone(t)
}

/** Replace this tournament's local copy with `bundle` (clears stale rows first). */
export async function writeTournament(bundle: TournamentBundle): Promise<void> {
  if (!idbAvailable()) return
  const db = await openDB()
  try {
    await clearInternal(db, bundle.tournament.id)
    const t = db.transaction([...STORES], 'readwrite')
    t.objectStore('tournaments').put({ ...bundle.tournament, hydratedAt: Date.now() })
    bundle.divisions.forEach(d => t.objectStore('divisions').put(d))
    bundle.registrations.forEach(r => t.objectStore('registrations').put(r))
    bundle.courts.forEach(c => t.objectStore('courts').put(c))
    bundle.matches.forEach(m => t.objectStore('matches').put(m))
    await txDone(t)
  } finally {
    db.close()
  }
}

/** Read the whole tournament back, or null if it hasn't been hydrated. */
export async function readTournament(id: string): Promise<TournamentBundle | null> {
  if (!idbAvailable()) return null
  const db = await openDB()
  try {
    // Create every request synchronously, then await the tx — interleaving awaits with new
    // requests on the same tx would let it auto-commit mid-read.
    const t = db.transaction([...STORES], 'readonly')
    const tReq = t.objectStore('tournaments').get(id)
    const dReq = t.objectStore('divisions').index('tournament_id').getAll(range(id))
    const rReq = t.objectStore('registrations').index('tournament_id').getAll(range(id))
    const cReq = t.objectStore('courts').index('tournament_id').getAll(range(id))
    const mReq = t.objectStore('matches').index('tournament_id').getAll(range(id))
    await txDone(t)
    if (!tReq.result) return null
    return {
      tournament: tReq.result as Row,
      divisions: dReq.result,
      registrations: rReq.result,
      courts: cReq.result,
      matches: mReq.result,
    }
  } finally {
    db.close()
  }
}

/** Matches for one division (the working set a scoring screen reads/writes). */
export async function getMatchesForDivision(divisionId: string): Promise<StoredMatch[]> {
  if (!idbAvailable()) return []
  const db = await openDB()
  try {
    const t = db.transaction(['matches'], 'readonly')
    const req = t.objectStore('matches').index('division_id').getAll(range(divisionId))
    await txDone(t)
    return req.result
  } finally {
    db.close()
  }
}

/** Upsert changed match rows (e.g. after a local score + advance). */
export async function putMatches(matches: StoredMatch[]): Promise<void> {
  if (!idbAvailable() || matches.length === 0) return
  const db = await openDB()
  try {
    const t = db.transaction(['matches'], 'readwrite')
    matches.forEach(m => t.objectStore('matches').put(m))
    await txDone(t)
  } finally {
    db.close()
  }
}

/** Upsert changed registration rows (e.g. after a local check-in). */
export async function putRegistrations(regs: Row[]): Promise<void> {
  if (!idbAvailable() || regs.length === 0) return
  const db = await openDB()
  try {
    const t = db.transaction(['registrations'], 'readwrite')
    regs.forEach(r => t.objectStore('registrations').put(r))
    await txDone(t)
  } finally {
    db.close()
  }
}

/** Remove a tournament's entire local copy (a "clear offline data" control). */
export async function clearTournament(id: string): Promise<void> {
  if (!idbAvailable()) return
  const db = await openDB()
  try {
    await clearInternal(db, id)
  } finally {
    db.close()
  }
}

export type { StoreName }
