# Realtime Smoke Test — Joinzer

> Manual two-device pass for the Phase 1 realtime architecture (`docs/phases/realtime-architecture.md`).
> Realtime delivery (WebSockets) can't be exercised by the automated gates, so run this once against
> a real deployment before relying on it. ~15–20 min.

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
