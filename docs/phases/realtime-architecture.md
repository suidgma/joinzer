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
| `leagueBroadcast.ts` | `broadcastLeagueFixtures(leagueId)` — coarse per-league "fixtures changed" signal for deny-all `league_fixtures`. |
| `components/ui/RealtimeRefresh.tsx` | Drop-in client component: subscribes to a broadcast topic and debounce-triggers `router.refresh()`. The third consumption mode (below). |
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
4. **Consume** — three modes, pick by how the data is shaped:
   - **Fine-grained list** from a client-readable table → `useRealtimeList({ topic, table, filter, initial, mapRow, onReconcile })` (chat).
   - **Broadcast patch** — the event carries enough to update local state → `useRealtimeChannel({ topic, broadcast: [event] }, onEvent)` or a typed wrapper (`useAttendanceBroadcast`).
   - **Broadcast-triggered refetch** — deny-all *aggregate* data (standings/results, fixtures across formats) where per-row patching isn't practical → drop `<RealtimeRefresh topic={…} events={[…]} />` on the page (or a layout) and it re-derives from fresh server data. Reuses the existing loader; no client SELECT, no patch logic. This is how live league fixtures work (one `<RealtimeRefresh>` in `leagues/[id]/layout.tsx` covers every format's standings/ladder/flex/team surface).
5. **Publish the table** (only for `postgres_changes`): `alter publication supabase_realtime add table public.<t>;` — and make sure it has a scoped SELECT policy the viewer satisfies.

That's it — no new provider, socket, or dependency.

---

## 8. Best practices

- **Patch, don't refetch.** Update the one changed row; never `router.refresh()` from a realtime handler.
- **Optimistic + dedupe by id.** Insert optimistic rows with a client-generated id so the realtime
  echo de-dupes and edits/deletes reconcile uniformly (see `ChatPanel.handleSend`).
- **Keep broadcast payloads minimal and non-PII** (ids + a status/enum). The client already has, or
  can fetch, the rest.
- **Broadcast is best-effort** (but retries once on a transient send failure). Always after a
  successful write; never let it block or fail the write. Broadcast is **ephemeral** — a receiver
  disconnected during a send misses it, so broadcast consumers reconcile on reconnect
  (`RealtimeRefresh` + `NotificationBell` refresh/refetch on error → subscribed), matching
  `useRealtimeList.onReconcile`.
- **Scope topics by entity UUID** so channels stay small and don't cross-talk.

---

## 9. Pitfalls

- **Deny-all + postgres_changes delivers nothing.** The #1 gotcha. Use broadcast, or add a scoped
  SELECT policy — verify per table.
- **RLS-scoped postgres_changes need an AUTHED realtime socket.** If a table's SELECT policy is
  membership-scoped (`auth.uid()`, e.g. chat) or even just `to authenticated`, an *unauthenticated*
  realtime connection receives **nothing** — the viewer sees their own optimistic write but never
  others' live (symptom: "only updates after refresh", or flaky "first few work then stop"). Gotcha:
  supabase-js does **not** auth realtime on `INITIAL_SESSION` (cookie restore on page load — its
  `_handleTokenChanged` only reacts to `TOKEN_REFRESHED`/`SIGNED_IN`/`SIGNED_OUT`), so on a fresh load
  the socket is authed only if `connect()`'s `getSession()` callback wins a race against the channel
  joining. `RealtimeProvider` fixes it by calling **`supabase.realtime.setAuth()` (no args —
  callback-based fresh token)** on mount, every auth change, and on tab focus (reconnect-after-idle).
  `setAuth` **re-authorizes already-joined channels**, so it's fine that it runs after child
  subscriptions. (Only `USING(true)` tables like `tournament_matches` deliver on an anon socket.)
- **Broadcast channels are public.** Anyone who knows a topic (an entity UUID) can subscribe. That's
  why payloads are non-PII. For stricter control, adopt Realtime Authorization (private channels +
  RLS on `realtime.messages`) — see §10.
- **Un-awaited broadcasts in serverless** may not flush before the function freezes — `await` the
  broadcast (it's internally best-effort, so awaiting is safe).
- **Don't re-subscribe on every render.** Key effects on the topic string, keep handlers in refs.

---

## 10. Shipped (Phase 2) + remaining extension points

**Shipped July 14, 2026 (Phase 2):**
- **Toasts** — `components/ui/ToastProvider.tsx` (auto-dismiss, capped stack, de-duped, non-throwing
  `useToast`). `WhoIsComing` toasts when *another* player changes status. Generic for any future event.
- **Unread badges (in-context)** — `ChatPanel` shows an "N new" badge computed from a localStorage
  last-read timestamp per entity, cleared when the viewer engages (expand / focus / send / pill).
- **Live scores (tournaments)** — `tournament_matches` is **public-readable** (`matches_read` for
  anon+auth), so it uses `postgres_changes`, **not** broadcast. Migration `20260714000005` added it
  (plus `league_matches`, `league_session_players`) to the publication — which also **revived the
  `LiveScoreboard` and `LiveSessionManager` subscriptions that were silently dead** (they subscribed
  to tables that were never in the publication, so their "live" updates never fired). Correction to
  §3's earlier framing: not every match table is deny-all — check RLS per table.

- **Live league fixtures/results — full coverage** (box/ladder/flex/team **+ round robin**) —
  `league_fixtures` is deny-all, so each write route broadcasts `broadcastLeagueFixtures(leagueId)` and
  `<RealtimeRefresh>` in `leagues/[id]/layout.tsx` refetches the current sub-page. Instrumented: box/
  ladder score, all 5 flex routes, ladder round + finalize, team matchup + line scores, flex
  self-schedule, and every generation route (box generate/save, cycle advance, flex/team schedule).
  **RR scores** live too: the player-score route broadcasts, and because RR organizer scoring writes
  `league_matches` **client-side** (no `league_id` column → no postgres_changes filter), a gated
  `POST /fixtures-changed` ping re-emits the signal (called by `LockedRoundsScoring`/`MatchEntryForm`).
  The **public `/l/[id]`** spectator page mounts a self-contained `RealtimeProvider` + `RealtimeRefresh`
  (`PublicLeagueLive`) so anon viewers get live standings over the public broadcast channel.

**Shipped July 14, 2026 (Phase 3):**
- **Presence** — `usePresence(topic)` (Supabase Realtime Presence, keyed by user id) + a subtle
  `ViewerCount` ("N watching") on the tournament live scoreboard and public `/l/[id]`.
- **Cross-app unread nav badges** — `ChatUnreadProvider` (app layout) loads the user's chat sources
  (`GET /api/chat/unread-sources`, leagues + tournaments, 30-day bound), compares each to the
  per-entity localStorage last-read (same key ChatPanel writes), subscribes per source (sharing
  ChatPanel's channel), and shows a dot on the Leagues/Tournaments nav; ChatPanel dispatches a
  `chat:read` event to clear it. **Per-entity** subscriptions because the message tables' SELECT RLS
  is `USING(true)` (see security note).
- **Interactive bracket live** — `DivisionManageView` merges other scorers' `tournament_matches`
  changes, but **skips any match with an unsynced local write** (`dedupeKey === match.id` in the
  bracket queue) so offline/in-progress scores are never clobbered. Online-only; RunMode + print untouched.

**Shipped July 14, 2026 (Phase 4):**
- **Chat edit/delete** — author UPDATE/DELETE RLS on league/tournament messages (migration
  `20260714000007`; event already had it) + ChatPanel inline edit/delete UI. Optimistic; the realtime
  UPDATE/DELETE handler (already present) reconciles other viewers.
- **Live notification bell + toasts** — `createNotification(s)` broadcast to `notifications:<userId>`;
  `NotificationBell` toasts + re-fetches the count instantly (poll kept as a 120s fallback).
- **Live tournament check-in** — organizer `PlayersTab` subscribes to `tournament_registrations`
  (published + readable) and patches the check-in map live.

**Bespoke-channel cleanup — done (July 14, 2026):** every component-level realtime now goes through
`useRealtimeChannel` / the ChannelManager. The pre-refactor callers (TournamentOrganizerView, GroupChat,
LiveSessionManager, DivisionsSection) were migrated. The **only** direct `supabase.channel()` calls left
are `channelManager.ts` (the manager) and `usePresence.ts` (the one documented exception — presence is
stateful per-viewer and doesn't fit the fan-out model).

**Private-channel authorization — done for notifications (July 14, 2026, migration `20260714000008`):**
the per-user `notifications:<userId>` broadcast is now a **private channel** — `ChannelSpec.private`
sets `config.private`, `serverBroadcast(..., { private: true })` flags the message, `RealtimeProvider`
eagerly calls `realtime.setAuth()`, and an RLS policy on `realtime.messages`
(`realtime.topic() = 'notifications:' || auth.uid()`) authorizes the join. Validated headlessly with two
signed-in users (own topic subscribes + receives; another's is `CHANNEL_ERROR`). **To make any channel
private:** add its `realtime.messages` SELECT policy, set `private: true` on the spec, and pass
`{ private: true }` to the server broadcast. **Deliberately still public:** attendance (non-PII
`{status, id}`) and `league-fixtures` (anon spectators on `/l/[id]` must receive it).

**Remaining:** nothing on the core realtime program — only the manual two-device UI pass (and a browser
check that the private notifications channel authorizes on a real session; the mechanism is proven).
- **Chat RLS hardened (July 14, 2026, migration `20260714000006`):** message SELECT (all 3 tables) +
  league/tournament INSERT are now scoped to membership via `SECURITY DEFINER` helpers
  (`is_{league,tournament,event}_chat_member`) — previously SELECT was `USING(true)` (any authed user
  could read any chat) and league/tournament INSERT only checked `user_id = auth.uid()`. ChatPanel
  render is member-gated to match, so non-members don't see the server-rendered initial batch either.
  (Cross-app unread still subscribes per-entity — correct regardless, and now doubly safe.)

---

## 11. What shipped vs. deferred

**Shipped (Phase 1):** the infra (`lib/realtime/`), single shared socket, `ChatPanel` on the shared
stack (edit/delete-ready, "N new messages", reconnect refetch), live attendance for round-robin
(`WhoIsComing`) and box/ladder (`BoxAttendanceManager`) via broadcast, and the connection indicator.

**Shipped (Phase 2, July 14, 2026):** toasts (`ToastProvider` + attendance toasts), in-context chat
unread badge, and live tournament scores (publishing `tournament_matches` — which also fixed the
dead `LiveScoreboard`/`LiveSessionManager` subscriptions). See §10.

**Deferred:** live league fixtures (deny-all → broadcast), interactive-bracket live, cross-page unread
nav badges, presence. Each is additive on this foundation.

**Notes:** `WhoIsComing` moved from `postgres_changes` to broadcast; `league_session_attendance`
remains in the `supabase_realtime` publication (harmless, now unused by that component). Chat
message tables stay on `postgres_changes` (they're client-readable). Needs a two-device manual smoke
test before relying on it — run the checklist in **`docs/phases/realtime-smoke-test.md`** (chat,
attendance, reconnect, one-socket, mobile).
