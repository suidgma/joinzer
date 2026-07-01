import { hydrateFromServer } from './hydrate'
import { drainOutbox, outboxCount } from './outbox'
import { getQueue, drainQueue } from '../pendingQueue'
import { readTournament, type TournamentBundle } from './tournamentDB'

// The run-mode sync/reconcile step. On reconnect: drain every queued write FIFO, then — only if
// fully drained — bulk-refetch the whole tournament and replace the local store, so any
// server-assigned ids (the double-elim reset row) become authoritative. See
// docs/phases/offline-run-mode-phase-2.md §10.

export const scoreQueueKey = (tournamentId: string) => `bracket_${tournamentId}`

export type ReconcileResult = {
  status: 'synced' | 'partial' | 'offline'
  pending: number
  bundle: TournamentBundle | null
}

function scoreQueueLength(tournamentId: string): number {
  try { return getQueue(scoreQueueKey(tournamentId)).length } catch { return 0 }
}

/** Total un-synced writes across the score queue (Phase 1) and the run-mode outbox. */
export async function pendingCount(tournamentId: string): Promise<number> {
  return (await outboxCount()) + scoreQueueLength(tournamentId)
}

export async function reconcile(tournamentId: string): Promise<ReconcileResult> {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine
  if (!online) {
    return { status: 'offline', pending: await pendingCount(tournamentId), bundle: null }
  }

  // Scores first: a resolve-playoffs op (outbox) depends on the scores that produced the
  // standings, so those PATCHes must land server-side before it. Then drain the outbox.
  await drainQueue(scoreQueueKey(tournamentId))
  await drainOutbox()

  const pending = await pendingCount(tournamentId)
  if (pending > 0) {
    // Something didn't sync — do NOT refetch. Replacing the store now would clobber the writes
    // that are still queued. Keep showing the local copy; the next reconnect retries.
    return { status: 'partial', pending, bundle: await readTournament(tournamentId) }
  }

  // Clean drain → bulk-refetch replaces the store with authoritative server state.
  const fresh = await hydrateFromServer(tournamentId)
  return { status: 'synced', pending: 0, bundle: fresh ?? (await readTournament(tournamentId)) }
}
