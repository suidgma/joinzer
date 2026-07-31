// Relative, not `@/` — this module has unit tests, and vitest has no alias config, so a `@/`
// specifier fails to resolve at runtime (it also can't be intercepted by vi.mock). Next
// resolves both forms identically.
import { createClient } from '../supabase/client'
import { chatReadKey } from './unread'

// Durable chat read state. The single write path to `chat_reads` (migration
// 20260731000001) — ChatPanel calls it when a chat is marked read, and ChatUnreadProvider
// calls it once on load to promote any localStorage key that's ahead of the server.
//
// localStorage is still written alongside this, but only as an optimistic cache so the dot
// clears instantly; the table is the source of truth. Before it existed, read state lived
// ONLY in localStorage, so clearing the browser cache made every chat look unread and
// reading on your phone never cleared the dot on your desktop.
//
// The write is a client-side upsert under RLS rather than an API route: the rows are strictly
// self-scoped, so the policy (`user_id = auth.uid()` + chat membership) is the whole
// authorization rule, and ChatPanel already writes its messages the same way. ADR-03's "the
// route is the security boundary" applies to service-role writes, which bypass RLS.

export type ChatReadTable = 'event_messages' | 'league_messages' | 'tournament_messages'

// Last value we actually sent per chat, so repeat calls carrying the same timestamp don't
// each cost a round trip. This is idempotence, not debouncing — nothing is delayed, batched
// or written on a trailing timer, and every existing trigger still fires. It matters because
// markRead() already re-fires with an UNCHANGED newest timestamp: the expand effect re-runs
// on every message change, and the IntersectionObserver re-fires whenever the panel scrolls
// back into view. localStorage absorbs that for free; a network write would not.
//
// The two call sites recover differently, which is why the latch is released on every failure
// path below rather than relying on a retry. ChatPanel calls this repeatedly, so a released
// latch really does retry. ChatUnreadProvider's one-time promotion fires once per page session
// with a timestamp that never advances — nothing there would ever call again.
const lastSent = new Map<string, string>()

export async function markChatRead(
  table: ChatReadTable,
  entityId: string,
  lastReadAt: string,
): Promise<void> {
  if (!lastReadAt) return
  const key = chatReadKey(table, entityId)
  if (lastSent.get(key) === lastReadAt) return
  lastSent.set(key, lastReadAt)

  // The latch must be released on EVERY failure path, including a thrown one. supabase-js
  // reports most failures in `error`, but `auth.getUser()` rethrows anything that isn't an
  // AuthError — notably `LockAcquireTimeoutError`, which a routine multi-tab Web Locks steal
  // produces. Without this catch that ordinary condition would strand the latch at a
  // timestamp that was never written, and since markRead() recomputes the same value until a
  // new message arrives, every later call would short-circuit and never retry.
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      lastSent.delete(key)
      return
    }

    const { error } = await supabase.from('chat_reads').upsert(
      { user_id: user.id, source_table: table, entity_id: entityId, last_read_at: lastReadAt },
      { onConflict: 'user_id,source_table,entity_id' },
    )

    // Read state is a convenience, never a blocker: a failed write leaves localStorage correct
    // for this device. Release the latch so the next call can retry.
    if (error) lastSent.delete(key)
  } catch {
    lastSent.delete(key)
  }
}
