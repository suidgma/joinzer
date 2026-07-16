# Substitutions + Home Action Center — Strategic Plan

> Planning doc. No code. Grounded in a full read-only audit of the current codebase (Home, substitute/attendance infra, notifications/realtime/chat, eligibility/standings/RLS). Reference this during implementation; update as phases land.

---

## 0. Executive summary

- **The hard parts already exist.** A race-safe atomic-claim pattern is in prod (host-claim), sub-placement helpers (`assignRrSub`, `assignAttendanceSub`) keep `sub_credit_cap` correct automatically, and `createNotification` fans out to in-app bell + live realtime toast + web-push in one call. We are **assembling proven primitives**, not inventing infrastructure.
- **The gap is a real "request → matched pool sees it → first eligible accepts atomically → sub is placed" flow.** Today there are two *disconnected* half-systems: `league_sub_requests` (RR-only; request→claim→approve with full notifications, but `approve` **never places the sub** and the claim is **not atomic**) and `sub_nominations` (all surfaces; self-pick a *named* person, applied immediately; its approval machinery is dead code). Neither matches, neither broadcasts to a pool, neither lets a third party accept.
- **Recommended path:** generalize `league_sub_requests` into a format-agnostic request record, replace its no-op `approve` with an **atomic conditional-accept** (`.eq('status','open').select()` → 409) that calls the existing placement helpers, add a lightweight **opt-in pool flag** + **server-side matching loader**, and surface matched opportunities in a new Home **"Needs Your Attention"** section built as **server-derived typed action items** (not a new DB table, not a generic framework).
- **Do not make chat the source of truth.** A system chat line ("Abigail will sub for Marty in Session 4") is an optional, later, non-authoritative echo.

---

## 1. Current-state audit

### 1.1 Home page
- `app/(app)/home/page.tsx` — one `async` **server component**, `max-w-lg` single column identical on mobile/desktop, **3-wave `Promise.all`** fetch (regs/orgs → sessions/profile/events/tournaments → attendance/sub-requests) then in-memory assembly. All reads via **service-role admin client** (page is the auth boundary; always filters by `user.id`).
- Sections: greeting → **amber "nudge band"** (missing rating, missing home court, pending partner, pending tournament invite) → My Schedule (top 5 unified `session|tournament|event`, `PlayerCheckIn` inline for sessions) → onboarding/role CTAs → `UpcomingEventsSection` (own ranked discovery via `scoreItem`) → **`SubRequestsSection`** (open `league_sub_requests` in my leagues, limit 5, claim button).
- **The amber nudge band is the de-facto "needs attention" zone** — hand-rolled per type, no shared component, no priority order. It's the natural insertion/merge point for an Action Center.
- **No priority/aggregation abstraction exists** anywhere. Closest prior art: the `notifications` bell (passive reverse-chron log), `OpsHealthStrip` (organizer status pills), `SetupChecklist` (actionable rows). Nav (`BottomNav`/`DesktopNav`) already renders a per-tab **chat-unread dot** via `useChatUnread()`.
- Drift to fix: nudges read **legacy** rating fields (`rating_source`/`dupr_rating`/`estimated_rating`), not the current `self_reported_rating`/Joinzer-Score model. Home & `/schedule` **duplicate** the schedule-assembly logic (no shared loader).

### 1.2 Substitute / attendance infrastructure
| System | Scope | Behavior | Verdict |
|---|---|---|---|
| `league_sub_requests` (`20260502000001`) | **RR only** | `open→claimed→approved` + full email/in-app notifs; but **approve places nothing**, **claim is not atomic** (app-level check + plain UPDATE = TOCTOU), `requested_skill_level`/`division_type` **stored-only** | **Best skeleton to extend** |
| `sub_nominations` (`20260713000003`) | play/league/tournament | Self-pick a **named** person, **applied immediately** via `assignRrSub`/`assignAttendanceSub`/`user_id` swap; approve/decline/cancel **dead code** (POST always writes `approved`) | Reusable as "I already know who" shortcut |
| `assignRrSub` / `assignAttendanceSub` | RR / box·ladder·flex·team | Placement helpers: set `sub_for_session_player_id` / `subbing_for_registration_id` + `has_sub` | **Directly reusable — call on accept** |
| `league_session_players` / `league_attendance` | RR / unified | Placement targets (`player_type sub/guest`; `guest_name`) | Reusable |
| `league_session_subs`, `player_availability` | — | Latent "who can sub / who's around" supply signals, unused for matching | Weak/latent |
| `leagues.sub_credit_cap` (`20260504000002`, default 7) | all | **Points cap at standings time** (`Math.min(pts, cap)`), not an assignment-count cap — applies automatically when placement helpers set the linkage | Reuse as-is |

- **Inconsistencies:** RR alone has the request/claim system and the legacy attendance triad (`league_session_players` + `league_session_attendance` + `league_session_subs`); box/ladder/flex/team use unified `league_attendance`; **Team + Flex have no sub path at all**; two paradigms (`league_sub_requests` vs `sub_nominations`) are both wired into the same `PlayerCheckIn.tsx`.
- **Atomic-claim pattern (copy this):** `app/api/league-sessions/[sessionId]/host/route.ts` — `.update(...).eq('id',x).is('host_user_id', null).select()` → `if (!rows.length) 409`. Also `register_doubles_pair` (`SELECT … FOR UPDATE` RPC) for capacity-bounded accepts, and `reapAbandonedOrders` (re-check-on-write) for expiry.
- **Guests/outside players:** `lib/users/stubs.ts` `createStub` (full invitable/ratable account) or ephemeral session/period guest (`player_type:'guest'` / `guest_name`).

### 1.3 Notifications / realtime / chat
- `createNotification` (`lib/notifications/create.ts`) = **in-app bell row + private realtime broadcast (`notifications:<userId>`, toast+badge) + web-push** in one call. Email is a **separate** `sendEmail` (`lib/email/send.ts`, Resend, logged to `email_log`). The **`league_sub_requests` routes are a copy-ready template** for this fan-out.
- **No per-category notification preference** exists (`notify_new_sessions` gates only the new-session email blast). `profiles.discoverable` opt-out exists and is honored in the directory. **No "available to sub" flag.**
- **Announcements: entirely missing** — no `message_type`/`is_pinned`/`is_system`/organizer-only posting on any message table. Chat is flat/chronological. Smallest addition = **one column on `league_messages` + one organizer-gated server route + ChatPanel styling/pin ordering**; rides existing realtime (`useRealtimeList` patches by id) with **zero infra change**.
- **SMS: absent** (no Twilio). Channels are in-app + realtime + web-push + email only.
- Realtime seams: `lib/realtime/topics.ts` (add topic+event), `serverBroadcast.ts`, `useRealtimeList`/`useRealtimeChannel`/`RealtimeRefresh`. Rule: **postgres_changes for client-readable tables, server Broadcast for deny-all** (subs/attendance/notifications are deny-all → broadcast).

### 1.4 Eligibility / standings / RLS
- **Matching signals actually available (ranked):** (1) gender×format compatibility — strong (`profiles.gender` + `lib/taxonomy/formats.ts`); (2) league membership / prior participation — strong (`league_registrations` + attendance/fixtures); (3) home-court distance — **real "within X miles" is buildable** (`profiles.home_court_id → locations.lat/lng` + existing `haversineMeters`/`distanceMiles`/`scoreItem`), nullable where home court unset; (4) self-reported skill level — good **soft** band (`self_reported_rating → scoreToLevel`, ±1-tier band already coded), unverified/nullable; (5) `discoverable` — must-honor gate; (6) `player_availability` — weak boost.
- **Not ready:** calculated Joinzer Score (only ~16 players earned — tiebreak, don't gate); `dupr_verified` (no API); **explicit "available to sub" opt-in (must build)**; live geolocation (none).
- **RLS constraints:** claim/assign **write must be a service-role API route** (sub tables + attendance + fixtures are deny-all; `league_registrations` has no client writes). Build the candidate pool **server-side**. Place via the helpers (never write linkage tables directly) so `sub_credit_cap` stays correct. Authority = `canOperateSession` (RR) / `lib/tournament/access.ts` `canOperate` (tournaments). Honor `discoverable`, exclude `dummy`.

### 1.5 Constraints & risks carried into the plan
- Home is hard-capped `max-w-lg` (MVP: keep it; a wider desktop Action Center means changing `<main>`).
- Two sub paradigms + dead approval code = **must not add a third**; consolidate onto one record.
- Placement/credit is subtle — **only** mutate rosters through `assignRrSub`/`assignAttendanceSub`.
- Rating data is sparse — matching must **degrade gracefully** to self-report and never hard-block on a missing rating.

---

## 2. Recommended product behavior (end-to-end)

### 2.1 Labels & wording (recommended)
- **Home section:** **"Needs Your Attention"** — action-oriented, matches Joinzer's direct player-first voice, scales to many item types. (Rejected: "For You"/"Recommended for You" imply discovery; "Action Center" corporate; "What's Happening" feed-y.)
- **Can't-make-it flow:** prompt **"Can't make it?"** → **"Mark me absent"** / **"Find me a sub"**.
- **Request-active status:** **"Finding a sub…"** → **"Sub found — Abigail"** → **"No sub found"** (+ requester CTA "Cancel request").
- **Opportunity card action:** primary **"Sub for this session"** (secondary **"View details"**). On accept, confirm toast **"You're in — see you on the court."**
- **Compact summary item:** **"3 sub opportunities near you →"**.

### 2.2 Requesting a sub
Player hits `cannot_attend` in the attendance UI → the **"Can't make it?"** sheet appears → **"Find me a sub"** creates a structured `sub_request`. **Prefill everything the system knows** (league, session/occasion, date/time, location, division/format, player being replaced, covered registration/session-player id, gender requirement if any, `sub_credit_cap`, expiration = session start). **Only optional field: a short note.** (Drop "someone in mind", "notify previous subs first", "auto-withdraw toggle" from MVP — auto-withdraw at session start is a server default, not a user choice; "someone in mind" = use the existing `sub_nominations` self-pick shortcut instead.)

### 2.3 Discovering an opportunity
Matched opportunities appear in Home **"Needs Your Attention"** (top 1–2 inline cards + a "See all N" row when more) and on a focused **"/subs"** browse page (reached from "See all"). A card shows: league name · format/division · date+time · venue · skill/eligibility hint · singles/doubles · players-needed · **urgency chip** (Today / Tomorrow / Starts in 2h) · "played here before" badge · availability state.

### 2.4 Accepting
Tap **"Sub for this session"** → server route: authenticate, **re-derive eligibility server-side**, **atomically claim** (`.eq('status','open').select()` → 409 if lost), **place via `assignRrSub`/`assignAttendanceSub`**, mark request `filled`, notify requester (+organizer), broadcast removal from the pool. **First valid acceptance wins; no organizer approval by default.**

### 2.5 Viewing status / cancel / withdraw
- **Requester** sees the live status line in their schedule/attendance card (§2.1) and can **Cancel request** while open.
- **Accepted sub** sees the session in *their* schedule; can **Withdraw** (re-opens the request, notifies requester+organizer) up to a cutoff.
- **Original player becomes available again:** while `open`, they cancel; while `filled`, they can request the spot back (organizer-mediated, later phase) — MVP: contact organizer.

### 2.6 Organizer visibility & control
Organizer sees requests/fills in the live session surface (already reads `league_sub_requests`) and gets an in-app notification on fill. Organizer can **manually assign** a known sub (existing `assign-sub` route). Default = **no approval required**.

### 2.7 Home presentation & full browse
- **Placement:** the Action Center **absorbs the amber nudge band** — profile-completion prompts become action items within **"Needs Your Attention"**, placed **directly below the greeting, above My Schedule**. One prioritized zone instead of scattered nudges.
- **Density:** show the top ~3 items; overflow → "See all". Sub opportunities: ≤2 inline cards + "See all N". Never overwhelm — the section is bounded.
- **Full browse:** a focused **`/subs`** route (not a new nav tab — nav is full at 6). MVP tabs: **Open (eligible)** + **My requests**. Defer history (past appearances, filled/expired archives).

### 2.8 Notifications (recommended behavior — useful, low-noise)
| Event | Recipients | Channels |
|---|---|---|
| New matched opportunity | opted-in eligible subs | in-app + push (**no email** by default) + realtime Home |
| Your request was accepted | requester (+organizer) | in-app + push + email |
| Sub withdrew (re-opened) | requester + organizer | in-app + push |
| Request canceled | subs who had it queued | in-app (quiet) |
| Request expired / no sub | requester (+organizer) | in-app |
| Organizer assigned a sub | requester + sub | in-app |
| Session changed after accept | sub + requester | in-app + push |
- **Noise control:** only notify players who **opted into the sub pool** (`open_to_subbing`) — this is the key lever and doubles as the matching gate.
- **System chat line** ("Abigail will sub for Marty in Session 4") — optional, Phase 4, non-authoritative echo via a `system` message type.

### 2.9 Announcements (Part 6 — later phase)
One chat, plus an **organizer-only "announcement" message type** in the existing `league_messages`: emphasized styling + 📣 label + pinned slot (ordering), optional targeted higher-priority notification to all members (→ bell/push/email), and an **unread announcement → Action Center item**. Column-on-existing-chat + organizer-gated server route; no second chat, no new realtime.

---

## 3. Recommended architecture

### 3.1 Data model
- **Generalize `league_sub_requests` → format-agnostic `sub_requests`** (new table, or add scope columns to the existing one; new table is cleaner and lets us keep the old one during migration). Columns: `id`, `surface` (`league_session|league_period|tournament|event`), scope ids (`league_id`, `league_session_id`?, `league_period_id`?, `covered_registration_id`?, `covered_session_player_id`?, `tournament_id`?, `event_id`?), `requesting_user_id`, format/eligibility snapshot (`format`, `division_type`, `gender_required`, `skill_hint`), `status` (`open|filled|cancelled|expired`), `filled_by_user_id`, `filled_at`, `expires_at`, `note`, `created_at`. **Partial unique index: one `open` request per (occasion, requester).** Deny-all RLS (server-mediated).
- **New opt-in flag:** `profiles.open_to_subbing boolean default false` (+ column GRANT so the client can read/toggle it). This is **both** the pool-membership gate and the notification preference. (Optional later: a coarse radius/skill preference.)
- **No new `action_items` table.** Action items are **derived on read** (see 3.7).
- **Keep** `sub_credit_cap` + placement-linkage columns exactly as-is.

### 3.2 Server-side operations (all service-role API routes; route = auth boundary)
- `POST /api/sub-requests` — create (prefilled server-side from the occasion; requester must be the covered registered player; block if generation already happened for formats that require pre-generation placement).
- `POST /api/sub-requests/[id]/accept` — **atomic claim** (`.update({status:'filled', filled_by:me}).eq('id',id).eq('status','open').select()` → 409 if empty) → **placement** via `assignRrSub`/`assignAttendanceSub` → notify → broadcast. Re-derive eligibility server-side; never trust client.
- `POST /api/sub-requests/[id]/cancel` (requester/organizer) and `.../withdraw` (accepted sub → re-open).
- `GET /api/sub-requests?scope=eligible|mine` — server-side matched pool (needs service-role for ratings/attendance).
- Organizer manual assign: reuse existing `assign-sub` routes.

### 3.3 Matching (MVP model — hard gates + soft score, all server-side)
- **Hard gates:** not the requester; opted-in (`open_to_subbing`); `discoverable`; not `dummy`; **gender×format** compatible; **singles/doubles** eligible; not already in that occasion; no **schedule conflict** with the player's own Joinzer session at the same time; request still `open` and not past cutoff.
- **Soft score (rank only):** home-court **distance** (existing haversine), **skill within ±1 tier** of the request hint (self-report fallback), **prior participation** in this league, `player_availability` "available today". Reuse `scoreItem`'s shape.
- **Degrade gracefully:** missing rating/home court → don't exclude; just rank lower / show "skill unknown". **MVP does not gate on calculated Score** (too sparse).
- **Later:** calculated Joinzer Score as a tiebreak, radius preference, previous-sub-history weighting.

### 3.4 Realtime
- Reuse the **per-user private channel** `notifications:<userId>` — a new opportunity / accept / withdraw already reaches it through `createNotification`. Home mounts a `RealtimeRefresh` on that topic so **"Needs Your Attention"** re-derives live.
- Add `subRequestsTopic(leagueId)` (public broadcast) so the **`/subs` list** and organizer live view update when a request opens/fills (deny-all table → broadcast, per the rule).

### 3.5 Authorization & RLS
- Deny-all `sub_requests`; all mutation via service-role routes that authenticate + re-derive authority (`canOperateSession` for organizer actions; per-participant checks for request/accept/withdraw).
- `open_to_subbing` on `profiles` needs a **column GRANT** to be client-readable/writable (table SELECT is intact on `profiles`, but follow the grant model for the new column's client write).
- Honor `discoverable`; exclude `dummy`; never expose PII in the candidate pool (names + first-name only, per `docs/security.md`).

### 3.6 Atomic claiming (the load-bearing correctness requirement)
Conditional-update-returning-rows (`host/route.ts` pattern) — **no lock, no RPC needed** for the single-seat case. For **multi-sub** occasions (N needed), either N separate seat rows or a `register_doubles_pair`-style `FOR UPDATE` RPC that decrements remaining-needed atomically. MVP: single-seat conditional update; multi-sub deferred.

### 3.7 Home action aggregation (Part 7 verdict — **hybrid, derived, typed**)
- `lib/home/actionItems.ts` → `loadActionItems(userId, ctx): ActionItem[]`, composed from **existing records** (reuses Home's fetch waves): profile-completion, attendance-needed, sub-opportunity (matched), your-sub-request-status, (later) unread-announcement, payment-required, score-confirmation.
- `type ActionItem = { id; type; priority; title; subtitle?; urgency?; cta?; href?; dismissible? }`. Frontend renders the typed list; a new type slots in **without rework**. **Not** a DB-backed `action_items` table (premature), **not** a generic rules engine (disproportionate). This is "derived items from existing records, composed by one server loader" — the balance between one-off and over-abstraction.
- Migrate the amber nudges into `ActionItem`s as the first two types; sub-opportunity is the third.

### 3.8 Integration with standings & sub-credit
No change to standings/credit code. Accept → placement helper → linkage columns set → `Math.min(pts, sub_credit_cap)` keeps applying. **Do not** touch `publicStandings.ts`/`fixtureStandings.ts`.

### 3.9 Chat system messages & outside players
- System chat line is **optional, Phase 4**, via the `message_type='system'` column (same mechanism as announcements). Structured `sub_requests` row stays the source of truth.
- **Outside player = a logged-in Joinzer user who is not a registered member.** MVP: must have an account to accept (encourages signup, keeps records trustworthy); accepting creates a **session-only participation record** (`league_session_players`/`league_attendance` sub row), **not** a league registration. Required profile to accept: name + gender (only if the format requires it); **skill not required**. Repeat subs stay session-scoped. Organizer manual-assign can use a **stub** (`createStub`) for a truly account-less sub.

---

## 4. Phased implementation plan

> Reordered from the prompt's suggestion based on the audit: consolidate the request record + atomic accept **first** (RR), because the skeleton, placement helpers, and notifications already exist there; generalize to other formats and build the Action Center after the lifecycle is correct.

### Phase 1 — Substitution request lifecycle + atomic accept (RR)
- **Goals:** one correct request→accept→place→notify flow for round-robin session leagues; first-valid-acceptance, no organizer approval by default.
- **Files/systems:** new `sub_requests` table; `app/api/sub-requests/*` routes; `lib/leagues/assignRrSub.ts` (reuse); `lib/notifications/create.ts` + `lib/email/send.ts` (reuse); `lib/realtime/topics.ts` (+`subRequestsTopic`). Retire/redirect `league_sub_requests` create/claim to the new record.
- **Dependencies:** none (all primitives exist).
- **Migrations:** create `sub_requests` (deny-all) + partial-unique one-open-per-(occasion,requester); `profiles.open_to_subbing` + column grant. **Apply before deploying reading code.**
- **Security:** service-role routes; re-derive requester = covered player; accept re-derives eligibility; atomic conditional update; honor `discoverable`/`dummy`.
- **Testing:** unit — matching gates, eligibility; **concurrency test — two simultaneous accepts, exactly one wins (409 for the other)**; placement sets `sub_for_session_player_id`+`has_sub`; credit cap still applies in standings.
- **Acceptance:** a RR player requests a sub → an eligible opted-in player accepts → sub is placed in the session, requester+organizer notified, request leaves the pool; a second accept gets a clean "already filled".
- **Risks:** double-accept race (mitigated by conditional update); placing before/after round generation (guard like `sub_nominations`); leaving the old `league_sub_requests` half-wired (plan a clean cutover).

### Phase 2 — Attendance integration + status + generalize to box/ladder/flex
- **Goals:** the "Can't make it?" decision flow; request status visible in schedule/attendance cards; extend accept+place to `league_attendance` formats; organizer manual assign.
- **Files/systems:** `components/features/leagues/PlayerCheckIn.tsx`, `BoxLadderCheckIn.tsx` (decision sheet); schedule/attendance cards on Home + `/schedule`; `lib/leagues/assignAttendanceSub.ts` (reuse for accept); existing `assign-sub` routes.
- **Dependencies:** Phase 1.
- **Migrations:** extend `sub_requests.surface` handling to `league_period` (box/ladder) + flex; no schema change if columns are already generic.
- **Security:** same route model; box/ladder/flex placement via `assignAttendanceSub`.
- **Testing:** per-format placement (box/ladder/flex); status transitions render correctly; manual-assign path.
- **Acceptance:** box/ladder/flex players can request+fill subs; every attendance surface shows the correct sub status line; organizer can assign manually.
- **Risks:** format inconsistencies (RR triad vs unified attendance) — keep placement behind the two helpers only; Team/Flex nuances (Team deferred; Flex is player-scheduled so subbing may be a no-op — confirm scope).

### Phase 3 — Home "Needs Your Attention" Action Center
- **Goals:** the typed action-item loader; migrate amber nudges; matched sub-opportunity cards + MVP matching; prioritization; responsive; "See all" → `/subs`; realtime.
- **Files/systems:** `lib/home/actionItems.ts` (new); `app/(app)/home/page.tsx` (insert section above My Schedule, absorb nudges, fix legacy-rating drift); a shared `ActionItem` card component (extract from nudge markup); `/subs` route (Open + My requests); `components/ui/RealtimeRefresh.tsx` on `notifications:<userId>`.
- **Dependencies:** Phase 1 (opportunities exist to show).
- **Migrations:** none.
- **Security:** matched pool built server-side; honor `discoverable`/`open_to_subbing`; PII-safe cards.
- **Testing:** matching produces the right pool for representative players; priority ordering; empty/overflow states; mobile+desktop layout; realtime refresh on new opportunity.
- **Acceptance:** an eligible opted-in player sees a matched opportunity card on Home within seconds of the request; "See all" opens `/subs`; profile-completion still surfaces (now as action items).
- **Risks:** over-crowding Home (bound to top-N + "See all"); matching false-positives/negatives (start conservative, log, tune); width constraint (keep `max-w-lg` for MVP).

### Phase 4 — Notifications & operational polish
- **Goals:** full fan-out per event with opt-in gating; expiration; withdrawal; schedule-conflict detection; optional system chat message on fill.
- **Files/systems:** the accept/withdraw/cancel routes (fan-out); a **daily/near-session expiration cron** (`app/api/cron/*`, reuse the `flex-deadlines`/`reapAbandonedOrders` patterns); `lib/realtime` (already wired); optional `message_type='system'` insert.
- **Dependencies:** Phases 1–3; the `message_type` column (shared with Phase 5) if system messages are wanted.
- **Migrations:** none (or the shared `message_type` column if pulling system messages forward).
- **Security:** cron `CRON_SECRET`-guarded; notifications honor opt-in.
- **Testing:** expiry closes open requests + notifies; withdrawal re-opens; conflict detection; no-noise verification (only opted-in get "new opportunity").
- **Acceptance:** unfilled requests expire at session start with a clean notification; a withdrawal re-opens and re-notifies; opted-out players get zero opportunity pings.
- **Risks:** notification noise (opt-in gate is the control); cron reliability (Hobby-plan daily-cron limit — mirror the multi-division-cart note).

### Phase 5 — Official announcements
- **Goals:** organizer-only emphasized/pinned announcements in the single league chat; higher-priority notification; unread-announcement action item; basic targeting.
- **Files/systems:** `league_messages` (+ `message_type`); new `POST /api/leagues/[id]/announce` (organizer-gated insert, optionally `createNotifications` to all members); `components/features/ChatPanel.tsx` (styling + pinned slot + `message_type` in selects/`Message` type); `lib/home/actionItems.ts` (unread-announcement type).
- **Dependencies:** Phases 1–3 (Action Center for the unread item).
- **Migrations:** `message_type text not null default 'chat'` on `league_messages` (extend to tournament/event later). Apply before reading code.
- **Security:** announcement insert **only via the organizer-gated route** (don't trust a client flag); membership SELECT RLS unchanged.
- **Testing:** only organizers can post announcements; pinned ordering; realtime patch keeps the pinned item; unread → action item; targeting (league/division/session) scoping.
- **Acceptance:** an organizer posts an announcement that's visually distinct, pinned, notified to members, and shows as an action item until read.
- **Risks:** scope creep (targeting) — MVP announcement = whole-league only; division/session targeting later.

**Deferred beyond these phases:** Team-league subs (needs the captain lineup flow), tournament sub-*opportunity* (spot-transfer already exists), calculated-Score matching, geo-radius preferences, per-category notification prefs, full sub-history archives, multi-sub-per-occasion at scale.

---

## 5. MVP vs later

- **Required for first usable release:** Phase 1 (RR request→atomic accept→place→notify) + Phase 2 (Can't-make-it flow + status + box/ladder) + Phase 3 (Home matched opportunity cards + `/subs` + basic matching). This is a coherent, shippable substitution product with the Action Center foothold.
- **Valuable shortly after:** Phase 4 (expiration cron, withdrawal, conflict detection, opt-in notification tuning, action-item unification of all nudges).
- **Future (must not delay launch):** Phase 5 announcements; Team/Tournament subs; calculated-Score & radius matching; history screens; per-category prefs; wider desktop Action Center layout.

---

## 6. Open decisions (need your call — recommendations given)

1. **Sub-pool model: opt-in vs opt-out?** *Recommend opt-in* (`open_to_subbing default false`) — controls notification noise and cleanly answers "don't show every request to everyone." Trade-off: fewer subs surfaced until players opt in. (Opt-out = max reach, more noise, more setup to suppress.)
2. **Who may accept a sub?** *Recommend:* any logged-in Joinzer user who passes the format/gender/skill gates — **not** restricted to existing league members — to maximize fills, with accepting creating a session-only record (not a registration). Confirm you're comfortable with non-members subbing.
3. **Minimum profile to accept?** *Recommend:* name + gender (only when the format requires gender); **skill optional** (soft filter, "skill unknown" shown). Confirm.
4. **Keep `sub_nominations` (self-pick "I already know who") alongside the new opportunity flow, or retire it?** *Recommend keep* as the "I have someone in mind" shortcut, and route the "Find me a sub" broadcast through the new `sub_requests`. Confirm (this avoids a disruptive migration).
5. **Section label:** confirm **"Needs Your Attention"** (my pick) vs "For You".
6. **Announcements timing:** confirm Phase 5 (after the substitution MVP), not folded into Phase 1.

Everything else (atomic-claim mechanism, placement via existing helpers, notification fan-out, no new action-items table, one-chat + message-type announcements, immediate acceptance default) has a strong codebase- or Excel-workflow-backed default and is recommended above without a question.

---

## Appendix A — Edge-case dispositions

| Case | MVP disposition |
|---|---|
| Two accept near-simultaneously | **Prevent** — atomic conditional update; loser gets 409 "already filled" |
| Sub accepts then withdraws | **Support** — withdraw re-opens request, notifies requester+organizer |
| Original player available again | **Partial** — cancel while `open`; while `filled`, contact organizer (reclaim = later) |
| Organizer cancels the session | **Support** — cascade cancels open requests (session cancel already exists); notify |
| Session time/location changes | **Support (Phase 4)** — notify sub+requester; keep the fill |
| Absent player cancels request | **Support** — `cancel` while open |
| No sub found before session | **Support (Phase 4)** — expire at cutoff, notify |
| Sub already scheduled at same time | **Prevent** — schedule-conflict hard gate in matching/accept |
| Sub rating outside range | **Allow, ranked lower** — soft filter, never hard-block (data too sparse) |
| Sub incomplete profile | **Gate minimally** — name + gender(if required); else prompt to complete before accept |
| Sub blocked/suspended/ineligible | **Prevent** — exclude via `discoverable`/`dummy`/eligibility (no block system yet — note gap) |
| Fixed-doubles partner replacement | **Support** — placement helper links the pair (existing) |
| Rotating RR participant replacement | **Support (Phase 1)** — `assignRrSub` |
| Singles replacement | **Support (Phase 1)** |
| Team-league lineup replacement | **Defer** — needs captain flow |
| Multiple subs needed same session | **Defer** (single-seat MVP); architecture leaves room |
| One sub accepts multiple openings same window | **Prevent** — schedule-conflict gate |
| Sub plays but results never entered | **Existing behavior** — standings handle missing scores; no new logic |
| Results corrected after standings | **Existing behavior** — recompute already supported |
| Obey sub-credit max | **Automatic** — via placement helpers + existing cap-at-standings |
| Notifications disabled | **Support** — respects push-subscription presence + (new) opt-in; in-app always recorded |
| Filled outside Joinzer, close manually | **Support** — organizer cancel/assign |
| Organizer manually assigns a known sub | **Support** — existing `assign-sub` routes |
| Requester sends an opportunity link to a person | **Defer** — MVP is pool-based; direct-link is a later add (or use `sub_nominations` self-pick) |
| Outside player opens link logged out | **Support** — link → login/signup → then accept (encourages account creation) |
| Radius/eligible-pool-only visibility | **Support (soft)** — matching ranks by distance; hard radius = later preference |

## Appendix B — Prompt-part → section map
Part 1 (Action Center/label/placement) → §2.1, §2.7, §3.7. Part 2 (can't-make-it) → §2.2, §2.5. Part 3 (discovery/accept/approval/outside) → §2.3–2.6, §3.2, §3.6, §3.9. Part 4 (browse destination) → §2.7. Part 5 (notifications) → §2.8, §3.4. Part 6 (announcements) → §2.9, Phase 5. Part 7 (architecture) → §3.7. Part 8 (edge cases) → Appendix A. Part 9 (audit) → §1.
