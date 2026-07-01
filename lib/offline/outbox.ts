import { openDB, txDone, OUTBOX_STORE } from './tournamentDB'

// The single run-mode outbox: every offline day-of write (check-in / resolve-playoffs /
// reschedule) is applied to the store immediately and its intent appended here, then replayed
// FIFO on reconnect. IndexedDB-backed (the whole tournament already lives there) and keyed by an
// auto-increment `seq` so order is preserved. Scoring keeps using the Phase-1 pendingQueue path
// inside BracketView; run mode's sync status sums both. See docs/phases/offline-run-mode-phase-2.md.

export type OutboxOp = {
  seq?: number
  url: string
  method: 'POST' | 'PATCH' | 'DELETE'
  body?: string
  dedupeKey?: string
  enqueuedAt: number
}

const idbAvailable = () => typeof indexedDB !== 'undefined'

/** Append an op. If `dedupeKey` is set, any prior op with the same key is dropped (last write wins). */
export async function enqueueOp(op: Omit<OutboxOp, 'seq' | 'enqueuedAt'>): Promise<void> {
  if (!idbAvailable()) return
  const db = await openDB()
  try {
    const t = db.transaction([OUTBOX_STORE], 'readwrite')
    const store = t.objectStore(OUTBOX_STORE)
    const entry = { ...op, enqueuedAt: Date.now() }
    if (op.dedupeKey) {
      const all = store.getAll()
      all.onsuccess = () => {
        for (const e of all.result as OutboxOp[]) {
          if (e.dedupeKey === op.dedupeKey && e.seq != null) store.delete(e.seq)
        }
        store.add(entry)
      }
    } else {
      store.add(entry)
    }
    await txDone(t)
  } finally {
    db.close()
  }
}

/** All queued ops in FIFO (seq) order. */
export async function listOps(): Promise<OutboxOp[]> {
  if (!idbAvailable()) return []
  const db = await openDB()
  try {
    const t = db.transaction([OUTBOX_STORE], 'readonly')
    const req = t.objectStore(OUTBOX_STORE).getAll()
    await txDone(t)
    return (req.result as OutboxOp[]).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  } finally {
    db.close()
  }
}

export async function outboxCount(): Promise<number> {
  if (!idbAvailable()) return 0
  const db = await openDB()
  try {
    const t = db.transaction([OUTBOX_STORE], 'readonly')
    const req = t.objectStore(OUTBOX_STORE).count()
    await txDone(t)
    return req.result
  } finally {
    db.close()
  }
}

export async function deleteOp(seq: number): Promise<void> {
  if (!idbAvailable()) return
  const db = await openDB()
  try {
    const t = db.transaction([OUTBOX_STORE], 'readwrite')
    t.objectStore(OUTBOX_STORE).delete(seq)
    await txDone(t)
  } finally {
    db.close()
  }
}

export async function clearOutbox(): Promise<void> {
  if (!idbAvailable()) return
  const db = await openDB()
  try {
    const t = db.transaction([OUTBOX_STORE], 'readwrite')
    t.objectStore(OUTBOX_STORE).clear()
    await txDone(t)
  } finally {
    db.close()
  }
}

export type DrainResult = { synced: number; failed: number; remaining: number }

/**
 * Best-effort FIFO replay. Stops at the first failure so causal order is preserved (a later op
 * may depend on an earlier one — e.g. resolve-playoffs after the scores that produced them).
 * Every target route is idempotent, so a partial drain + retry is safe. The bulk-refetch reconcile
 * that follows a clean drain is step 5.
 */
export async function drainOutbox(onProgress?: (remaining: number) => void): Promise<DrainResult> {
  let synced = 0
  let failed = 0
  for (const op of await listOps()) {
    try {
      const res = await fetch(op.url, {
        method: op.method,
        headers: { 'Content-Type': 'application/json' },
        body: op.body,
      })
      if (res.ok) {
        if (op.seq != null) await deleteOp(op.seq)
        synced++
        onProgress?.(await outboxCount())
      } else {
        failed++
        break
      }
    } catch {
      failed++
      break
    }
  }
  const remaining = await outboxCount()
  onProgress?.(remaining)
  return { synced, failed, remaining }
}
