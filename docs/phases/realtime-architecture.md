# Realtime Architecture — Joinzer

> Status: **Phase 1 shipped (July 14, 2026)** — reusable infra + chat + live attendance +
> connection indicator. Built on Supabase Realtime (already in the stack). No new deps,
> no React Query. This doc is the source of truth for how realtime works and how to extend it.

---

## 1. Goal

Joinzer should feel alive: when one player acts, everyone viewing that league/tournament sees
it without a manual refresh, and **only the thing that changed updates** — never a full page
refetch. This is a *foundation*, not a per-feature bolt-on: new realtime features plug into the
same provider/hooks with a few lines.

---

## 2. Why this shape

- **Transport = Supabase Realtime.** Already in the stack and already used. No separate
  WebSocket server. We replaced the *fragmentation* (each component opened its own
  `supabase.channel()` + socket), not the transport.
- **No React Query / global cache.** Data is server-rendered into `initial*` props and held in
  component `useState`. Realtime *patches that local state fine-grained* (append/replace/remove
  one row), which is the finest granularity possible — there is no global cache to invalidate.
  Adopting React Query would have meant re-plumbing data loading app-wide; deliberately skipped.
- **One shared client + socket.** `lib/supabase/client.ts` is now a memoized singleton, so every
  channel multiplexes over one WebSocket.

```
 RealtimeProvider            one shared browser client + socket + global connection status
        │
        ▼
 ChannelManager              refcounted channels (N subscribers to a topic share 1 channel)
        │
        ▼
 topics.ts (event registry)  typed topic names + broadcast event names
        │
        ▼
 hooks: useRealtimeChannel / useRealtimeList / useAttendanceBroadcast / useConnectionStatus
        │
        ▼
 components                  subscribe to what they care about; patch their own state
```

---

## 3. Two delivery mechanisms (the load-bearing decision)

Supabase `postgres_changes` **respects RLS**. Most Joinzer tables are **deny-all** (server/
service-role only), so a browser client subscribed to them receives **nothing**. So:

| Mechanism | Use for | Why |
|---|---|---|
| **`postgres_changes`** | Client-readable tables (the 3 chat message tables). | Fires on the real DB write, RLS-filtered, no extra wiring. |
| **Server broadcast** | Deny-all / sensitive tables (attendance, and future scores/fixtures). | The route that already authorized the write emits a minimal, non-PII event via `lib/realtime/serverBroadcast.ts`. The table's deny-all RLS stays intact. |

Both are consumed through the **same hook API** — a component subscribes to a topic and doesn't
care which mechanism feeds it.

**Rule of thumb when adding a feature:** if the data is already safe for the client to `SELECT`,
use `postgres_changes` (`useRealtimeList`). Otherwise broadcast it from the write route.

---

## 4. File map (`lib/realtime/`)

| File | Role |
|---|---|
| `RealtimeProvider.tsx` | Mounted once in `app/(app)/layout.tsx`. Owns the shared client + `ChannelManager`, derives global `ConnectionStatus` from every channel + browser online/offline. |
| `channelManager.ts` | Refcounted channel registry over one socket. Topic string fully determines a channel's bindings; payloads fan out to all listeners. |
| `topics.ts` | The **event registry**: typed topic builders (`chatTopic`, `attendanceTopic`) + broadcast event names (`RealtimeEvents`). Writers and readers import from here so they never drift. |
| `hooks.ts` | `useRealtimeChannel` (low-level), `useConnectionStatus`. |
| `useRealtimeList.ts` | Workhorse for `postgres_changes` list state (chat): INSERT appends, UPDATE replaces, DELETE removes, de-dup by id, reconnect reconciliation. |
| `useAttendanceBroadcast.ts` | Broadcast consumer for attendance status changes. |
| `serverBroadcast.ts` | Server helper: `broadcast(topic, event, payload)` via the Realtime HTTP endpoint. Best-effort, never throws, never blocks the write. |
| `components/ui/ConnectionIndicator.tsx` | Subtle header dot: green when live, "Reconnecting…" / "Offline" otherwise. |

---

## 5. Event flow

**Chat (postgres_changes):** server renders `initialMessages` → `ChatPanel` calls `useRealtimeList`
on `chatTopic(table, id)` filtered to the entity → a new row anywhere fires an INSERT that appends
the one message (de-duped by id) → optimistic sends insert with a client-generated id so the echo
de-dupes → edits/deletes patch/remove in place → on reconnect the tail is refetched once to fill any
gap. Scroll position is preserved (a "N new messages" pill appears if you're reading history).

**Attendance (broadcast):** player taps a status → the write route authorizes + writes the
(deny-all) table → the route calls `broadcast(attendanceTopic(occasionId), 'player.status.changed',
{ userId/registrationId, status })` → every subscriber (`WhoIsComing`, `BoxAttendanceManager`)
patches the one matching row. The occasion id is the `league_sessions.id` (round robin) or
`league_periods.id` (box/ladder).

---

## 6. Subscription lifecycle

- **Refcounting:** N components subscribing to the same topic share one channel; the channel is
  torn down when the last unsubscribes. `useRealtimeChannel` re-subscribes only when the *topic*
  changes; the handler is kept fresh via a ref, so passing a new closure each render is free.
- **Reconnect:** Supabase auto-reconnects the socket and re-joins channels. `useRealtimeList`
  watches for an `error → subscribed` transition and runs its optional `onReconcile()` once to
  refetch and reconcile events missed while offline.
- **Connection status:** derived from all channel statuses + `navigator.onLine`. `live` when all
  channels are subscribed, `reconnecting` if any errored, `offline` when the browser is offline.

---

## 7. How to add a realtime feature

1. **Add a topic + event** to `topics.ts` (`fooTopic(id)`, and a `RealtimeEvents.fooChanged` name
   if using broadcast).
2. **Pick the mechanism** (§3). Client-readable table → `postgres_changes`; deny-all → broadcast.
3. **Emit** (broadcast only): after the authorized write in the route, `await broadcast(fooTopic(id),
   RealtimeEvents.fooChanged, { …minimal non-PII payload… })`.
4. **Consume** in the component:
   - List from a client-readable table → `useRealtimeList({ topic, table, filter, initial, mapRow, onReconcile })`.
   - Broadcast → `useRealtimeChannel({ topic, broadcast: [event] }, onEvent)` (or a small typed wrapper like `useAttendanceBroadcast`).
5. **Publish the table** (only for `postgres_changes`): `alter publication supabase_realtime add table public.<t>;` — and make sure it has a scoped SELECT policy the viewer satisfies.

That's it — no new provider, socket, or dependency.

---

## 8. Best practices

- **Patch, don't refetch.** Update the one changed row; never `router.refresh()` from a realtime handler.
- **Optimistic + dedupe by id.** Insert optimistic rows with a client-generated id so the realtime
  echo de-dupes and edits/deletes reconcile uniformly (see `ChatPanel.handleSend`).
- **Keep broadcast payloads minimal and non-PII** (ids + a status/enum). The client already has, or
  can fetch, the rest.
- **Broadcast is best-effort.** Always after a successful write; never let it block or fail the write.
- **Scope topics by entity UUID** so channels stay small and don't cross-talk.

---

## 9. Pitfalls

- **Deny-all + postgres_changes delivers nothing.** The #1 gotcha. Use broadcast, or add a scoped
  SELECT policy — verify per table.
- **Broadcast channels are public.** Anyone who knows a topic (an entity UUID) can subscribe. That's
  why payloads are non-PII. For stricter control, adopt Realtime Authorization (private channels +
  RLS on `realtime.messages`) — see §10.
- **Un-awaited broadcasts in serverless** may not flush before the function freezes — `await` the
  broadcast (it's internally best-effort, so awaiting is safe).
- **Don't re-subscribe on every render.** Key effects on the topic string, keep handlers in refs.

---

## 10. Future extension points

- **Live scores / brackets / standings** — broadcast from the score routes (deny-all `tournament_matches`
  / `league_fixtures`) on a `match:<id>` / `division:<id>` topic; consume with `useRealtimeRecord`
  (a single-row sibling of `useRealtimeList`, to add).
- **Presence** ("who's viewing", 🟢 online) — Supabase Realtime Presence on the same provider; add
  `usePresence(topic)`.
- **Toast notifications** ("Sarah is running late", "Division announcement posted") — a small toast
  context fed by the same events. *Not built yet.*
- **Cross-page unread badges** (League Chat (3)) — a global set of chat subscriptions in the provider,
  independent of which page is open, feeding badge counts. *Not built yet* (needs the user's entity
  memberships loaded globally).
- **Private-channel authorization** — the hardening path for broadcast (per-user RLS on realtime
  messages) if attendance/score topics ever need to be non-public.

---

## 11. What shipped vs. deferred

**Shipped (Phase 1):** the infra (`lib/realtime/`), single shared socket, `ChatPanel` on the shared
stack (edit/delete-ready, "N new messages", reconnect refetch), live attendance for round-robin
(`WhoIsComing`) and box/ladder (`BoxAttendanceManager`) via broadcast, and the connection indicator.

**Deferred (documented above):** toasts, cross-page unread badges, live scores/standings, presence.
Each is additive on this foundation.

**Notes:** `WhoIsComing` moved from `postgres_changes` to broadcast; `league_session_attendance`
remains in the `supabase_realtime` publication (harmless, now unused by that component). Chat
message tables stay on `postgres_changes` (they're client-readable). Needs a two-device manual smoke
test before relying on it — run the checklist in **`docs/phases/realtime-smoke-test.md`** (chat,
attendance, reconnect, one-socket, mobile).
