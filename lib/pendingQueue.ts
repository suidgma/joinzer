// Offline-resilient request queue backed by localStorage.
// Each entry represents a single fetch that failed or was skipped due to being offline.
// Entries with the same dedupeKey replace each other (last write wins per logical operation).

export type PendingOp = {
  id: string
  url: string
  method: 'POST' | 'PATCH' | 'DELETE'
  body?: string
  dedupeKey?: string
  enqueuedAt: number
}

const storageKey = (sessionId: string) => `jz_pending_${sessionId}`

export function getQueue(sessionId: string): PendingOp[] {
  try {
    const raw = localStorage.getItem(storageKey(sessionId))
    return raw ? (JSON.parse(raw) as PendingOp[]) : []
  } catch {
    return []
  }
}

function persist(sessionId: string, queue: PendingOp[]): void {
  try {
    localStorage.setItem(storageKey(sessionId), JSON.stringify(queue))
  } catch {
    // QuotaExceededError — in-memory state is still correct for this session
    console.warn('[pendingQueue] localStorage write failed — queue held in memory only')
  }
}

export function enqueue(sessionId: string, op: Omit<PendingOp, 'id' | 'enqueuedAt'>): PendingOp {
  const entry: PendingOp = { ...op, id: crypto.randomUUID(), enqueuedAt: Date.now() }
  let queue = getQueue(sessionId)
  if (op.dedupeKey) {
    // Replace any existing entry for the same logical operation (e.g. same player status)
    queue = queue.filter(q => q.dedupeKey !== op.dedupeKey)
  }
  queue.push(entry)
  persist(sessionId, queue)
  return entry
}

function removeById(sessionId: string, id: string): void {
  persist(sessionId, getQueue(sessionId).filter(op => op.id !== id))
}

export function clearQueue(sessionId: string): void {
  localStorage.removeItem(storageKey(sessionId))
}

export type DrainResult = { synced: number; failed: number }

export async function drainQueue(
  sessionId: string,
  onProgress?: (pending: number) => void,
): Promise<DrainResult> {
  const queue = getQueue(sessionId)
  let synced = 0
  let failed = 0

  for (const op of queue) {
    try {
      const res = await fetch(op.url, {
        method: op.method,
        headers: { 'Content-Type': 'application/json' },
        body: op.body,
      })
      if (res.ok) {
        removeById(sessionId, op.id)
        synced++
      } else {
        failed++
      }
    } catch {
      failed++
    }
    onProgress?.(getQueue(sessionId).length)
  }

  return { synced, failed }
}
