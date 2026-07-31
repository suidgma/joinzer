// Pure chat-unread seeding logic, extracted so it can be unit tested (a provider/route can't
// be). No imports — keep it that way so vitest can load it; the repo has no alias config, so
// a `@/` import inside a module under test fails at runtime.

export const chatReadKey = (table: string, entityId: string) => `chat-read:${table}:${entityId}`

/**
 * The last-read timestamp that is safe to PERSIST, given the messages on screen.
 *
 * An in-flight optimistic row carries this device's clock (`new Date().toISOString()`), not the
 * database's. That value must never reach `chat_reads` or localStorage: both are read back
 * later — `chat_reads` on every other device, and localStorage on the next load, where the
 * provider promotes anything ahead of the server. A fast client clock persisted through either
 * route suppresses genuinely newer messages as already-read, durably and cross-device.
 *
 * So the rule is simply: an optimistic timestamp may live in React state, and must never be
 * written anywhere that outlives the render. Returns '' when every message is still in flight,
 * meaning there is nothing safe to persist yet.
 *
 * Shared by ChatPanel and GroupChat — both send optimistically, and this selection was
 * duplicated in each before it lived here.
 */
export function selectDurableLastRead(
  messages: { id: string; created_at: string }[],
  optimisticIds: Set<string>,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!optimisticIds.has(messages[i].id)) return messages[i].created_at
  }
  return ''
}

export type UnreadSource = {
  table: string
  entityId: string
  /** Timestamp of the newest message in this chat. */
  latest: string
  /** Durable last-read from `chat_reads`, null when the user has never read this chat. */
  lastReadAt?: string | null
}

export type UnreadSeed = {
  /** `${table}:${entityId}` for each chat with unread messages. */
  unreadKeys: string[]
  /**
   * Chats whose localStorage last-read is AHEAD of the server — i.e. read on this device
   * before read state was durable. Promoted to `chat_reads` once, on load, which is the
   * whole backfill: a browser that still holds its keys carries them up and sees no stale
   * badges. A browser that already cleared its cache has nothing to carry, so it sees one
   * final round of badges — that state is genuinely gone and nothing can recover it.
   */
  toPromote: { table: string; entityId: string; lastReadAt: string }[]
}

// Timestamps arrive in two shapes: PostgREST serializes timestamptz as `+00:00`, while
// ChatPanel's optimistic send writes `new Date().toISOString()`, which ends in `Z`. Those two
// don't compare correctly as strings even when they represent the same instant, and a
// localStorage key written from an optimistic send holds the `Z` form. So compare parsed
// instants, never the raw strings.
function ms(value: string | null | undefined): number | null {
  if (!value) return null
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : t
}

/**
 * Decide which chats are unread, seeding from the SERVER's read state with localStorage as an
 * optimistic overlay (it can only ever move last-read forward, never backward).
 *
 * A chat with no read state at all is unread — but that now means "no durable row AND no local
 * key", i.e. genuinely never read. Previously this was keyed on localStorage alone, so a cache
 * clear manufactured that condition for every chat at once, which was the bug.
 */
export function computeInitialUnread(
  sources: UnreadSource[],
  localReads: Record<string, string>,
): UnreadSeed {
  const unreadKeys: string[] = []
  const toPromote: UnreadSeed['toPromote'] = []

  for (const s of sources) {
    const serverMs = ms(s.lastReadAt)
    const latestMs = ms(s.latest)

    // Clamp the local value to this chat's newest message before promoting it. Existing
    // browsers hold keys written by the PRE-FIX code, which persisted the sending device's own
    // clock — so without this the very first load after deploy would promote that skew into
    // chat_reads, reintroducing exactly the defect the durable-value selection removes, on day
    // one and through the front door. A last-read AHEAD of the newest message carries no
    // information ("read past the end" is just "read"), so clamping discards nothing.
    let local = localReads[chatReadKey(s.table, s.entityId)]
    let localMs = ms(local)
    if (localMs !== null && latestMs !== null && localMs > latestMs) {
      local = s.latest
      localMs = latestMs
    }

    if (localMs !== null && (serverMs === null || localMs > serverMs)) {
      toPromote.push({ table: s.table, entityId: s.entityId, lastReadAt: local })
    }

    const readMs = Math.max(serverMs ?? -Infinity, localMs ?? -Infinity)
    if (readMs === -Infinity || (latestMs !== null && latestMs > readMs)) {
      unreadKeys.push(`${s.table}:${s.entityId}`)
    }
  }

  return { unreadKeys, toPromote }
}
