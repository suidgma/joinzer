# Realtime Smoke Test — Joinzer

> Manual two-device pass for the realtime architecture (`docs/phases/realtime-architecture.md`).
>
> **Transport validated (July 14, 2026).** Both realtime paths were confirmed end-to-end headlessly:
> a **server Broadcast** round-trip (HTTP `202` → a subscribed client received the payload, exact
> format `serverBroadcast.ts` uses) and a **postgres_changes** UPDATE on the newly-published
> `tournament_matches` (a real change was delivered to an anon subscriber, then reverted net-zero).
> So *"does realtime reach the client?"* is answered **yes** — including the previously-dead
> `LiveScoreboard` subscription. **Gotcha learned:** a *same-value* update fires **no** event; only
> real value changes do (fine in prod — scores genuinely change).
>
> What remains below is the **UI-level** two-device pass — optimistic dedupe, scroll preservation /
> "N new messages", toasts, unread badges, mid-edit refresh safety — which needs a real browser. ~15 min.

The two risk tiers: **chat** is a migration of already-working `postgres_changes` code (low risk);
**attendance** is the new **server-broadcast** path (verify carefully — §2, §2c).

---

## Setup

- **Two independent sessions** — two browsers, or one normal + one incognito window. Best: a **real
  phone (B) + desktop (A)**, which also covers the mobile check (§4).
- **Two accounts:** `A` = organizer/host, `B` = a registered player. (Dummy test accounts are fine —
  see the dummy-accounts memory.)
- **Content to test against:**
  - A **round-robin league** with a live session → tests `WhoIsComing`.
  - A **box or ladder league** with an active cycle/session → tests `BoxAttendanceManager`.
  - Any **Play event / League / Tournament** with chat.
- **Environment:** broadcast needs `SUPABASE_SERVICE_ROLE_KEY` in the env the routes run in
  (already set in Vercel; local dev needs it in `.env.local`). Prefer testing on the **deployed**
  site so the env + webhook/realtime infra match production.
- **DevTools open on both:** Console + Network (filter **WS** for the socket, **Fetch/XHR** for the
  broadcast POST).

---

## 0. One-socket sanity (infra)

- [ ] On a page that has chat **and** attendance, open Network → **WS**. Confirm exactly **one**
      connection to `…/realtime/v1/websocket` (the old code opened one per component).
- [ ] The header shows the **green dot** (`ConnectionIndicator`) — hover says "Live".

---

## 1. Chat (`postgres_changes`)

Run once inline and once in the expanded ("Open") view. Repeat across all three surfaces:
**Play event chat · League chat · Tournament chat.**

- [ ] B sends a message → appears on A within ~1s, **no refresh**.
- [ ] A sends → appears on B.
- [ ] **Optimistic + no dupe:** A's own message shows instantly (before the network round-trip) and
      does **not** duplicate when the realtime echo arrives (dedupe by client-generated id).
- [ ] **Scroll preserved:** on A, scroll up into history; B sends → A is **not** yanked down; a
      **"N new messages"** pill appears and increments per message.
- [ ] Click the pill → scrolls to bottom, count resets.
- [ ] **At-bottom auto-scroll:** A pinned at the bottom, B sends → A auto-scrolls to the new message.
- [ ] Author name shows for others' messages, hidden for your own.
- [ ] (Optional) **Send failure:** in DevTools block the insert → the optimistic message is removed
      and "Failed to send" appears.

---

## 2. Attendance (server **broadcast**) — the new path

### 2a. Round robin — `WhoIsComing`
- [ ] A views the league's **"Who's coming"** list; B (registered player) taps **I'm Here** →
      A's chip + "here / on the way" counts update live.
- [ ] B taps **Running Late** → A shows the amber "Late" chip live.
- [ ] B taps **Can't make it** → A updates live.
- [ ] **Organizer override:** A marks B's status from the session view → reflects (the route
      broadcasts for organizer edits too).

### 2b. Box / Ladder — `BoxAttendanceManager` (organizer grid)
- [ ] A is on the box/ladder **attendance grid**; B **self-checks-in** → the matching roster row's
      radio flips live on A (this surface was **not live at all** before).
- [ ] **Two admins:** A and a co-admin both on the grid; A marks a player → the co-admin sees it.
- [ ] The actor's own optimistic change isn't clobbered or duplicated when the echo returns.

### 2c. If attendance does NOT update — debug the broadcast (highest-risk piece)
1. **Did the route emit?** Check server logs / add a temporary log around the `broadcast(...)` call
   in the attendance route. It runs **after** the DB write succeeds.
2. **HTTP call OK?** In the *server* you won't see it in the browser; if testing locally, the route's
   `fetch` to `…/realtime/v1/api/broadcast` should get a **202**. A **401/403** = key/header problem
   (needs `apikey` + `Authorization: Bearer <service key>`); **404** = wrong endpoint path.
3. **Topic match?** The route emits `attendance:<occasionId>`; the client subscribes to the **same**
   string. `occasionId` = `league_sessions.id` (round robin) or `league_periods.id` (box/ladder) —
   confirm the component is passed the right id.
4. **Client subscribed?** ConnectionIndicator green + no console errors = the channel joined.
   Payload shape from the server is `{ messages: [{ topic, event, payload }] }`; a silent no-show is
   almost always a topic-string mismatch.

---

## 2.5 Live scores (tournament — `postgres_changes`)

These subscriptions were **dead** before (tables weren't in the publication); migration
`20260714000005` fixed it. Verify they actually fire now:

- [ ] A on the tournament **Live** tab (scoreboard); organizer B scores/updates a match → A's
      scoreboard, standings, and (rolling) court board update live, **no refresh**.
- [ ] Draft matches stay hidden; publishing a draft makes it appear live.
- [ ] (Round robin) A on the RR **live session** view; B marks a player's status → the row updates
      live (`league_session_players` now published).

## 2.6 Live league fixtures/results (broadcast → `RealtimeRefresh`)

Deny-all `league_fixtures`, so this is a broadcast-triggered `router.refresh()`. Two sessions on the
same league; A on the **Standings/Results** page (or ladder/flex/box run screen):

- [ ] **Box/Ladder:** B (organizer or player) scores a fixture → A's standings/results update within
      ~1s (a brief debounce), no manual refresh.
- [ ] **Flex:** B reports a score → A (organizer on the Flex screen) sees it; A confirms/resolves →
      standings update on both.
- [ ] **Team:** B scores a matchup/line → A's team standings update.
- [ ] Mid-edit safety: while A is typing in a score form, a refresh triggered by B's change should
      **not** wipe A's inputs (router.refresh preserves client state).
- [ ] Backgrounded tab: hide A's tab, have B score, return → A refreshes once on becoming visible.
- [ ] **Round robin:** A on the RR standings/results; B (organizer via manual entry, or a player via
      self-score) posts a score → A updates. (RR organizer writes are client-side + pinged via
      `/fixtures-changed`.)
- [ ] **Public spectator:** open `/l/<id>` (logged out, league must have public standings on); B scores
      anything → the public standings refresh live.

## 3. Connection indicator + reconnect

- [ ] DevTools → Network → **Offline** → indicator shows **"Offline"** (⚪).
- [ ] Back **online** → briefly **"Reconnecting…"** (amber) → **green**.
- [ ] **Reconnect reconciliation (chat):** go offline on A; have B send 2 messages; bring A back →
      A refetches the tail and shows the missed messages — **no gap, no duplicates**.
- [ ] **Background tab:** leave A's tab hidden a few minutes, return → it resumes / reconnects and
      new messages/status flow again.

---

## 4. Mobile (Joinzer is mobile-first)

- [ ] Run §1 and §2 with **B on a real phone** ↔ **A on desktop**. Confirm live updates, and that
      resuming the app from background reconnects promptly (no stuck "Offline").

---

## 5. Cleanup / regressions

- [ ] Navigate away from a chat/attendance page → its channel tears down (no leaked subscriptions;
      the WS traffic settles). Refcounting means shared topics only close on the **last** unsubscribe.
- [ ] No realtime-layer errors in the console during any of the above.

---

## Quick triage

| Symptom | Likely cause |
|---|---|
| Nothing live anywhere | No WS at all (§0); check `NEXT_PUBLIC_SUPABASE_URL` / `…_ANON_KEY`. |
| Chat not live | Message table missing from the `supabase_realtime` publication, or the client can't `SELECT` it (RLS). |
| Attendance not live | Broadcast debug — §2c (route didn't emit / topic mismatch / key on the HTTP call). |
| Own messages duplicate | Optimistic insert isn't using the client-generated id (dedupe key). |
| Indicator stuck "Reconnecting" | A channel is erroring — check console for the failing topic/table. |
