# Substitutions — Implementation Plan (post-decision)

> Implementation-ready. **No code yet.** Builds on the audit in `substitutions-action-center.md` (don't re-audit). Encodes the locked product decisions: one unified system built on `league_sub_requests`, two fulfillment paths, no organizer approval by default, atomic accept **+** placement in one transaction, RR/box/ladder first, Action Center on Home, `sub_nominations` consolidated.
>
> Firm answers to the two "make a recommendation" asks up front:
> - **Table generalization:** **Extend `league_sub_requests` in place, generalized league-only across `league_session_id` XOR `league_period_id` (session vs period scope). Do NOT add a generic `surface`/`occasion` model now.** RR uses `league_sessions`; box/ladder use `league_periods` — those two scopes cover the entire first release. Tournament/Play have *different* placement targets (`tournament_registrations`, `event_participants`) and already-working mechanics; a `surface` column today is a leaky abstraction with no near-term payoff. Add `surface` later, additively, when those domains join.
> - **Withdrawal-before-cutoff → reopen the same request:** **Confirmed cleanest.** Reopening the same row preserves request identity, the dedupe index, and the audit trail; no new record, no orphaned placement (the reopen and the un-placement happen in one transaction, mirror of accept).

---

## 1. Executive recommendation

Replace today's **two disconnected substitute lifecycles** with **one record and one placement primitive**:

- **`league_sub_requests` becomes the single source of truth** (extended, not replaced) — it already has request records, statuses, Home exposure, claim, in-app + email notifications, organizer/requester relationships, and audit logging. We keep those and fix the two fatal gaps: **its `approve` never placed the sub**, and **its claim was not atomic**.
- **One atomic operation** — a Postgres `SECURITY DEFINER` function does the conditional claim **and** the placement **in a single transaction**, so `status='filled'` and "a placement row exists" can never diverge. This is the crux requirement; an app-level read-then-write cannot guarantee it.
- **Two fulfillment paths, one architecture** — "Find me a sub" (`fulfillment_mode='open_pool'`) creates a discoverable opportunity; "I already have a sub" (`fulfillment_mode='self_assigned'`) creates the same record and immediately fills it, never entering the pool. `sub_nominations`' useful behavior (self-pick a named person) becomes this mode, not a competing subsystem.
- **Placement stays through the existing linkage** (`sub_for_session_player_id` / `subbing_for_registration_id` + `has_sub`), so `sub_credit_cap` and standings keep working untouched.

Why better than the dual system: one mental model for players, one record for organizers, atomic correctness, no dead approval states, and standings/credit preserved by construction.

---

## 2. Final product workflow

### 2.1 Player requests a sub
Trigger: the attendance control's **"I can't make it"** (`PlayerCheckIn` for RR, `BoxLadderCheckIn` for box/ladder) sets `cannot_attend`, then opens a **decision sheet**:

> **Can't make it?**
> - **Just mark me absent** (secondary/plain)
> - **Find me a sub** (primary)
> - **I already have someone** (secondary)

- **Find me a sub** → `POST /api/sub-requests` with `fulfillment_mode:'open_pool'`. Server prefills everything (league, session/period, date/time, venue, format, division, covered player, gender requirement, `sub_credit_cap`, `expires_at`=session start). **Only optional field: a one-line note.** Creates an `open` request; notifies the matched, opted-in pool.
- **I already have someone** → a player picker (reuse `PlayerCombobox` from `AddSubForMe`) → `POST /api/sub-requests` with `fulfillment_mode:'self_assigned'` + `chosen_user_id`. Server creates the record and immediately runs the same atomic accept for the chosen person; status → `filled`. Never discoverable. **The chosen person must pass the same HARD eligibility gates as an open-pool accept (§6); the requesting player cannot override them** — an ineligible pick is rejected with a clear reason. (Only an organizer can override the *soft* subset — see §2.6.)
- **Just mark me absent** → existing attendance write only; no request.

Requester status line (in their schedule/attendance card, reuses the existing card slot):
`Looking for a sub…` → `Sub found — Abigail` → `Sub withdrew — looking again` → `No sub found` → `Request cancelled`. Requester can **Cancel request** while `open`.

### 2.2 Substitute discovers an opportunity
Matched cards on Home ("Needs Your Attention") and the `/subs` browse page. Card: league name · date + time · venue · session/period · format (singles / fixed-doubles / rotating / box / ladder) · skill/eligibility hint · "played here before" badge · **urgency chip** (Today / Tomorrow / Starts in 2h) · primary **"Sub for this session"** (secondary "View details").
Recommended primary label: **"Sub for this session"** (specific, unambiguous; "I can sub" is the runner-up).

### 2.3 Substitute accepts
`POST /api/sub-requests/[id]/accept`:
1. Authenticate (`getUser`); **revalidate full eligibility server-side** (hard rules §6).
2. Call the atomic RPC `accept_sub_request(request_id, accepter_id)` → conditional claim (`status='open'` → `'filled'`) **+ placement** in one transaction.
3. `0 rows / already filled` → **409** "Someone just grabbed this one."
4. On success: fire notifications + realtime broadcast (post-commit, best-effort). Return a clear success ("You're in — see you on the court.").

### 2.4 Substitute withdrawal
`POST /api/sub-requests/[id]/withdraw` (only the `filled_by_user_id`; **self-service allowed until the session/period start time — no earlier buffer in the MVP**):
- Atomic RPC `withdraw_sub_request(request_id, user_id)` — in one transaction: reverse placement (delete the sub's session-player/attendance row, clear covered `has_sub` back to `cannot_attend`), set request `status='open'`, clear `filled_by/filled_at`, record the withdrawal in `audit_log`.
- Reopens the **same** request to the pool; notifies requester + organizer. Prior sub's participation history lives in `audit_log`. **After the start time → not self-serve; any change requires organizer action** (reopen/reassign/override).

### 2.5 Original player becomes available again
- While `open`: requester cancels the request (nothing to undo).
- While `filled`, **before generation** (rounds/fixtures not yet built): requester triggers "I can attend after all" → RPC removes the sub (same reversal as withdraw) + marks requester present + cancels the request; notify the sub + organizer.
- While `filled`, **after generation**: **requires organizer override** (removing a placed player after fixtures exist affects schedule/standings). Requester is told to contact the organizer.

### 2.6 Organizer controls
Organizer live surface (already reads `league_sub_requests`) shows all **open/filled** requests, who covers whom, and conflict/eligibility warnings. Organizer can: **manually assign** (existing `assign-sub` routes → now routed through the same placement primitive, may use a **stub/guest** when operationally necessary), **cancel**, **reopen**, and act **after the start-time cutoff** (remove/replace). **Soft-override:** when assigning a player who trips a *soft* restriction (rating mismatch, missing rating, logistical warning), the organizer confirms an explicit "override" prompt → the assign proceeds with `placed_with_override=true` + an `audit_log` entry. **Hard gates (integrity/suspension, duplicate placement, post-generation guard) are never overridable.** Audit history via existing `audit_log`. **No approval step** in MVP.

---

## 3. Final lifecycle & status model

**Final statuses (only these): `open`, `filled`, `cancelled`, `expired`.**

| Status | Meaning | Set by |
|---|---|---|
| `open` | Discoverable, awaiting an eligible acceptance (or reopened after withdrawal) | create (open_pool); withdraw; reopen |
| `filled` | Sub placed; participation row exists (invariant) | atomic accept; self_assigned create; organizer assign |
| `cancelled` | Closed by requester/organizer; no sub | cancel |
| `expired` | Cutoff passed with no fill | expiration cron |

**Removed / deprecated:** `claimed` (immediate accept goes `open`→`filled`, no interim), `approved` (no approval), `fulfilled` (was never implemented). **Not added:** `withdrawn` (withdrawal returns the request to `open`; the *event* is in `audit_log`, not a status), `failed` (the transaction rolls back → stays `open`; no false-fill state exists), `pending_approval` (future-only — see below).

**State-transition table (validated in the RPC/routes):**

| From | Event | To | Guard |
|---|---|---|---|
| — | create (open_pool) | `open` | requester = covered player; no existing `open` for (occasion, requester); placement guard not yet passed |
| — | create (self_assigned / organizer_assigned) | `filled` | + chosen player eligible; atomic placement succeeds |
| `open` | accept | `filled` | atomic claim wins; eligibility revalidated; placement succeeds (same txn) |
| `open` | cancel | `cancelled` | requester or organizer |
| `open` | expire (cron) | `expired` | `now() > expires_at` |
| `filled` | withdraw (sub) | `open` | before cutoff; reversal + reopen (same txn) |
| `filled` | requester reclaims | `cancelled` | before generation; reversal (same txn) |
| `filled` | organizer reopen/cancel | `open`/`cancelled` | organizer; after cutoff |

**Future path (do not build now):** an optional `leagues` approval-mode column could insert a `pending_approval` state between accept and placement. The status enum and the RPC are shaped so this slots in later without a breaking change. **No approval column, status, or UI in MVP.**

**Audit / history:** **reuse the existing `audit_log` + `lib/audit/log.ts`** for every transition (create/accept/withdraw/cancel/expire/assign/override) — it already logs sub claim/approve/cancel today. **No new events table.** "Who subbed then withdrew" is queryable from `audit_log`.

---

## 4. Proposed data model

### 4.1 `league_sub_requests` — extend in place (keep the name)
Add / change columns:
- `league_period_id uuid references league_periods(id) on delete cascade` — box/ladder scope. **XOR** with `league_session_id`.
- `covered_registration_id uuid` — the covered entrant's registration (box/ladder placement linkage). (RR covered session-player is derived at placement from `requesting_player_id` + session.)
- `fulfillment_mode text not null default 'open_pool' check (fulfillment_mode in ('open_pool','self_assigned','organizer_assigned'))`.
- `filled_by_user_id uuid references profiles(id)`, `filled_at timestamptz`.
- `expires_at timestamptz` (set at create = session/period start).
- `cancelled_at timestamptz`, `cancelled_by_user_id uuid`.
- `placed_with_override boolean not null default false` — set when an organizer soft-overrides an eligibility warning at assignment (display + audit; the override itself is recorded in `audit_log`).
- `format text`, `gender_required text` — matching/display snapshot (nullable).
- Keep + start USING `requested_skill_level`, `division_type`, `notes`, `requesting_player_id`, `league_id`, `league_session_id`.
- **Deprecate** `claimed_by_user_id`, `approved_by_user_id` (kept nullable for history; new code writes `filled_by_user_id`).

**Constraints:**
- `check ((league_session_id is not null) <> (league_period_id is not null))` — exactly one scope.
- `status` check → `('open','filled','cancelled','expired')`.

**Indexes (dedupe + query):**
- `unique (league_session_id, requesting_player_id) where status='open'` — **one active open request per covered player per session**.
- `unique (league_period_id, requesting_player_id) where status='open'` — same for periods.
- `(league_id, status)` — pool/organizer queries.
- `(filled_by_user_id) where status='filled'` — "my accepted subs".

**RLS (tighten):** currently `SELECT USING(true)`, insert-own, no update. Change to **SELECT only own rows** (`requesting_player_id = auth.uid() OR filled_by_user_id = auth.uid()`); **all writes service-role only** (RPC/routes). The matched pool + organizer views are served by **server-side loaders** (needs service-role to join ratings/conflicts anyway), so no client SELECT of the open pool is required. This is more private (a sub request reveals an absence) and matches the deny-all-write model.

### 4.2 `profiles` — opt-in preference
- `open_to_subbing boolean not null default false` (+ column GRANT so the client can read/toggle it). Gates **proactive surfacing** (Home cards + push notifications). Does **not** gate `/subs` browsing (any eligible player can browse). Toggle lives in `ProfileEditForm` + a one-tap prompt in the sub UI.

### 4.3 Migration treatment of existing data (pre-launch → test data, precision low-stakes but do it cleanly)
- Add columns/indexes additively; backfill `filled_by_user_id = coalesce(approved_by_user_id, claimed_by_user_id)` where those exist.
- Map legacy statuses: `claimed`/`approved`/`fulfilled` → `cancelled` (they were coordination records that **never actually placed a sub**, so they must not read as `filled` — that would violate the invariant); stale `open` with a past session → `expired`.
- `sub_nominations`: no data migration needed for MVP (league surfaces switch to the unified record going forward; existing nomination rows are historical). Fix the misleading table comment.

---

## 5. Server & transaction architecture

### 5.1 The atomic primitive — placement in SQL
Introduce a `SECURITY DEFINER`, locked-`search_path` plpgsql function that is the **single placement primitive** and does claim + placement in one transaction:

```
accept_sub_request(p_request_id uuid, p_accepter_id uuid) returns jsonb
-- one transaction:
-- 1. SELECT ... FROM league_sub_requests WHERE id = p_request_id FOR UPDATE
--    (row lock; re-read status + scope + guard)
-- 2. idempotency: if status='filled' AND filled_by_user_id = p_accepter_id -> return success
-- 3. if status <> 'open' -> RAISE 'already_filled'         (route -> 409)
-- 4. re-check placement guard (RR: no league_rounds; box/ladder: no league_fixtures for period)
--    -> RAISE 'generation_started' if violated                 (route -> 409/conflict)
-- 5. UPDATE league_sub_requests SET status='filled', filled_by_user_id=p_accepter_id, filled_at=now()
--    WHERE id=p_request_id AND status='open'                    -- conditional (belt + suspenders)
-- 6. PLACE (same txn):
--    RR (league_session_id): insert league_session_players sub row (user=p_accepter_id,
--        player_type='sub', sub_for_session_player_id = covered sp id, actual_status='present');
--        UPDATE covered sp -> actual_status='has_sub'
--    box/ladder (league_period_id): insert league_attendance sub row
--        (user=p_accepter_id, subbing_for_registration_id=covered_registration_id, status='present');
--        UPDATE covered attendance -> status='has_sub'
-- Any RAISE rolls back the WHOLE txn (claim + placement) -> no divergence possible.
```

- **Refactor the TS placement helpers to delegate here.** `assignRrSub` / `assignAttendanceSub` become thin wrappers that call the same placement path (via a shared plpgsql `place_league_sub(...)` extracted from step 6), so **organizer manual-assign and open-pool accept share one atomic placement primitive** and produce identical linkage. (Acceptable interim if the refactor is too large for one phase: RPC for accept only, keep the TS helpers for organizer-assign, with a linkage-parity test — but the unified primitive is the target.)
- `withdraw_sub_request(p_request_id, p_user_id)` and `reclaim_sub_request(...)`: mirror RPCs that reverse placement + set status in one transaction.

### 5.2 Routes (all service-role; route = auth boundary)
| Route | Auth | Body/behavior |
|---|---|---|
| `POST /api/sub-requests` | requester = covered registered player | create; `fulfillment_mode`; self_assigned/organizer_assigned immediately call `accept_sub_request` |
| `POST /api/sub-requests/[id]/accept` | any authed user; **revalidate eligibility** | call `accept_sub_request`; 409 on lost race |
| `POST /api/sub-requests/[id]/withdraw` | `filled_by_user_id`, before cutoff | `withdraw_sub_request` → reopen |
| `POST /api/sub-requests/[id]/cancel` | requester or `canOperateSession` | → `cancelled` |
| `POST /api/sub-requests/[id]/reopen` | `canOperateSession` | organizer reopen |
| `POST /api/sub-requests/[id]/assign` | `canOperateSession` | organizer manual assign (existing player / stub / guest) via placement primitive; accepts `override:true` to bypass **soft** warnings only (sets `placed_with_override`, writes `audit_log`); hard gates still enforced |
| `GET /api/sub-requests?scope=eligible\|mine\|accepted` | authed | server-side matched pool / own requests / my accepted |

Authorization reuses `lib/leagues/canOperateSession.ts` for organizer actions and per-participant checks for request/accept/withdraw. **Never trust client eligibility.**

### 5.3 Notification & realtime sequencing (post-commit, best-effort)
After the transaction commits, the route fires (order matters only for UX):
1. `createNotification`/`createNotifications` — in-app bell + private realtime toast/badge + web-push, in one call.
2. `sendEmail` for the channels that warrant email (§ notifications table).
3. `broadcast(subRequestsTopic(leagueId), 'changed')` — pool/organizer live views refresh; the accepter's/requester's Home re-derives via `notifications:<userId>`.

Failures here **do not** affect correctness (the placement is already committed). Idempotent retries are safe (notifications de-dupe by the request+event; a repeated accept returns the idempotent success from the RPC).

### 5.4 Failure-case design (explicit)
| Failure | Handling |
|---|---|
| Claim wins but placement fails | Same transaction → **whole thing rolls back**; request stays `open`. No false-fill. |
| Placement ok but status update fails | Impossible — both are in the one RPC transaction. |
| Two accept simultaneously | Row lock + conditional update → exactly one commits; other gets `already_filled` → 409. |
| Request expires during acceptance | RPC re-reads under lock; if a concurrent cron set `expired`, status ≠ `open` → 409. |
| Sub becomes ineligible during acceptance | Route revalidates pre-RPC; race window is tiny; RPC guards the race-critical invariants (status, generation). Soft criteria (rating) are non-blocking anyway. |
| Generation starts during acceptance | RPC checks the placement guard **under the row lock** → `generation_started` → 409. |
| Organizer changes session during acceptance | Session edits don't touch the request row; placement still valid; §5-post notifies of the change. |
| Notification/broadcast fails | Swallowed/retried; correctness unaffected. |
| Idempotency | Re-accept by the same user returns success; re-withdraw when already open is a no-op; cron expiry is `WHERE status='open'`. |

---

## 6. Matching & eligibility (finalized)

**Hard eligibility — non-negotiable; the opportunity is not acceptable if any fail (enforced in the route AND re-checked in the RPC under the row lock):**
- request `status='open'` and not past `expires_at`;
- user ≠ requester;
- **no duplicate participation** — user not already in that session/period;
- **no schedule conflict** — user has no other Joinzer session/period at the same time;
- **format eligibility** — singles vs doubles compatible;
- **required division gender** — only where the format requires it (mens/womens/mixed rules, `lib/taxonomy/formats.ts`);
- **account eligibility** — real Joinzer account, `discoverable`, not `dummy`, **not suspended/blocked (integrity)**, profile has the format minimum (name; gender when the format requires it);
- **operational placement guard** — rounds/fixtures not yet generated.

**Soft signals — ranking + warnings, NEVER a block (locked decision):**
- **Skill/rating is a rank + warning, not a gate.** A lower-rated player *may* accept. The opportunity card always shows the **recommended level**, and on a **meaningful mismatch** (≥1 tier below the request's `requested_skill_level`) the card and the accept-confirmation show a clear warning (e.g. "This session is Advanced — your level is Intermediate. Sub anyway?"). Ranking uses `self_reported_rating → scoreToLevel` (±1-tier comfort band, `scoreItem` shape); calculated Joinzer Score is a tiebreak only (too sparse to lead on).
- Other rank signals: prior participation in the league; previous-sub history; `player_availability` "available today" (later); **home-court distance** (`haversineMeters`/`distanceMiles`); organizer familiarity.

**Proactive-surfacing gate (a preference, not an eligibility rule — locked):** `open_to_subbing` (opt-in) gates **Home matched cards + proactive notifications only**. `/subs` is **browsable by every eligible player regardless of the preference**. For the MVP a **single `open_to_subbing` preference controls both** Home surfacing and proactive notifications; granular per-channel/per-category settings are deferred.

**Organizer soft-override (locked):** on the **organizer** manual-assign / organizer-mediated path, an organizer may override **soft restrictions only** — rating mismatch, missing rating, and certain logistical warnings — via an **explicit confirmation** that writes an **`audit_log`** entry and sets `placed_with_override=true` on the request (for display: "placed with organizer override"). **Non-overridable by anyone:** integrity/suspension, duplicate placement, and the post-generation safety guard. **The requesting player can never override hard rules** on the "I already have someone" path (§2.1) — only organizers can, and only the soft set.

**Deferred sophistication:** calculated Joinzer Score as a lead signal, geographic-radius preference, weighted scoring, DUPR, `player_availability` weighting.

---

## 7. Home Action Center ("Needs Your Attention")

- **Placement (validated against current Home):** greeting → **profile-completion nudges** → **Needs Your Attention** → **My Schedule** → the rest. This moves today's bottom-of-page `SubRequestsSection` up and reframes it. (Profile nudges stay above for v1 per the decision; folding them into the section is a later refinement.)
- **Composition (verdict): hybrid — server-derived typed items, no DB table.** New `lib/home/actionItems.ts` → `loadActionItems(userId)` returns `ActionItem[]` (`{ id, type, priority, urgency?, title, subtitle?, cta?, href? }`), composed from Home's existing fetch waves + the new matched-pool loader. Not a generic rules engine, not a throwaway one-off; a new type slots in without rework. `SubRequestsSection` is refactored into the first renderer of this list (not a second Home implementation).
- **v1 item types:** matched sub opportunity · your own open request (status: looking / filled / withdrew / none-found) · sub found (transient confirmation) · sub withdrew · urgent attendance confirmation (session soon, unconfirmed).
- **Max inline:** ~3 items; sub opportunities ≤2 inline; overflow → **"See all (N) →"** to `/subs`.
- **Ordering:** (1) your request needs action (withdrew / no-sub-found), (2) attendance due &lt;24h, (3) matched opportunity by urgency then rank, (4) your active open request. Within a type, ascending time-to-start.
- **Urgency:** Today / Tomorrow / Starts in Xh chips; escalate color &lt;3h.
- **Mobile & desktop:** keep `max-w-lg` single column for MVP (mobile-first; unchanged shell).
- **Empty state:** render nothing (section hidden) when no items — same as today's null-return sections.
- **Completed items:** disappear automatically (derived on read); "sub found — Abigail" shows transiently (short window / until dismissed) then drops.
- **Realtime:** mount `RealtimeRefresh` on `notifications:<userId>` (re-derive on any personal event) + `subRequestsTopic(leagueId)` for pool changes → a claimed opportunity vanishes from every viewer within a second.

**Secondary destination:** a dedicated **`/subs`** route (reached from "See all"; **not** a 7th nav tab). MVP views: **Open opportunities** (matched, ranked), **My accepted substitutions**, **My requests**. No history/filter beyond that until needed.

---

## 8. Existing-system consolidation

| Thing | Disposition |
|---|---|
| `league_sub_requests` | **Primary.** Extended in place (§4); statuses collapsed; `approve` replaced by atomic accept-with-placement; claim made atomic. |
| `sub_nominations` (league surfaces) | **Consolidated.** The "I already have someone" path becomes `fulfillment_mode='self_assigned'` on `league_sub_requests`. Remove `AddSubForMe`/`UndoSubButton` from `PlayerCheckIn`/`BoxLadderCheckIn`. Table + rows kept as historical; league writes stop. |
| `sub_nominations` (play + tournament) | **Untouched for MVP** (those surfaces are deferred and have a *single* model there — no dual-model problem). Migrate to the unified record when Play/Tournament phases arrive. |
| `sub_nominations` dead `approve`/`decline`/`cancel` code | Leave the play `approve` path (only place it's implemented); remove league-facing UI that reached it. Fix the misleading table comment. |
| `league_session_subs` + `SessionSubList` "I can sub" toggle | **Retire the toggle from the UI** (the opt-in pool + matching supersedes a third willingness concept). Leave the table/data; stop seeding from it once the unified flow ships. Optionally revive its intent later as a per-session "available" ranking signal. |
| `player_availability` | **Later** — soft ranking signal only; not wired into MVP matching. |
| Notification kinds | Replace `league_sub_claimed`/`approved`/`confirmed` with `sub_opportunity`, `sub_filled`, `sub_withdrawn`, `sub_expired`, `sub_reclaimed`, `sub_assigned`. Keep the fan-out helper untouched. |
| Home `SubRequestsSection` | **Refactored** into the first renderer inside "Needs Your Attention" (not deleted, not duplicated). |
| `PlayerCheckIn` "Need a sub?" | Becomes the "Can't make it?" decision sheet feeding `/api/sub-requests`. |

**End state: one user-facing substitute model for leagues.** No two mental models, no dead states surfaced.

---

## 9. Phased implementation plan

### Phase 1 — Unified substitute domain & data migration
- **Goals:** the extended `league_sub_requests` schema, collapsed statuses, opt-in flag, tightened RLS, migrated historical data. No behavior change yet.
- **Files/systems:** migration(s); `profiles` grant; RLS policies; type updates for the request shape.
- **Migrations:** columns/indexes/constraints (§4.1), `profiles.open_to_subbing` (§4.2), status/data migration (§4.3). **Apply to prod before deploying any reading code** (project rule).
- **Dependencies:** none.
- **Security:** new deny-all-write + own-read RLS; column grant for `open_to_subbing`.
- **Tests:** migration is additive/reversible; dedupe unique indexes reject a second open request; legacy statuses mapped; no standings/linkage columns altered.
- **Acceptance:** schema live; existing Home/league reads still work (served server-side); no user-visible change.
- **Rollback:** columns are additive; keep the old status values readable during the window; migration script idempotent.
- **Risks:** RLS tightening breaks a client that read the table directly — audit confirms reads are server-prop'd, but verify before deploy.

### Phase 2 — Atomic acceptance & placement (the correctness core)
- **Goals:** `accept_sub_request` / `withdraw_sub_request` / `reclaim_sub_request` RPCs; the shared `place_league_sub` primitive; refactor `assignRrSub`/`assignAttendanceSub` to delegate.
- **Files/systems:** new plpgsql functions (migration); `lib/leagues/assignRrSub.ts`, `lib/leagues/assignAttendanceSub.ts` (delegate); `app/api/sub-requests/[id]/accept|withdraw` routes.
- **Migrations:** the RPCs (SECURITY DEFINER, locked search_path, EXECUTE granted appropriately).
- **Dependencies:** Phase 1.
- **Security:** route authenticates + revalidates eligibility, passes accepter id; RPC enforces status/guard under row lock.
- **Tests (heaviest here):** two simultaneous accepts → one winner, one 409; claim-but-placement-fail rolls back (no false-fill); idempotent re-accept; withdraw reverses + reopens atomically; RR + box + ladder placement sets correct linkage + `has_sub`; guard blocks accept after rounds/fixtures exist. **Standings regression:** sub earns points, covered player capped at `sub_credit_cap`, sub's own stats correct, corrected results recompute, public-standings parity.
- **Acceptance:** an `open` request can be accepted exactly once, the sub is placed, and standings/credit are provably unchanged in behavior.
- **Rollback:** drop RPCs; helpers revert to prior implementations (keep the old code path in git).
- **Risks:** porting placement to SQL diverging from TS behavior — mitigate with the linkage-parity tests and by making the helpers *call* the primitive.

### Phase 3 — Player request & known-sub flows
- **Goals:** the "Can't make it?" decision sheet; open_pool + self_assigned creation; requester status line.
- **Files/systems:** `PlayerCheckIn.tsx`, `BoxLadderCheckIn.tsx` (decision sheet, remove `AddSubForMe`); `POST /api/sub-requests`; schedule/attendance card status rendering; reuse `PlayerCombobox`.
- **Migrations:** none.
- **Dependencies:** Phases 1–2.
- **Security:** requester = covered registered player; self_assigned validates the chosen player.
- **Tests:** create open_pool (dedupe enforced); self_assigned fills immediately; both honor the generation guard; status line renders each state; UI: decision flow.
- **Acceptance:** a player can request a sub (either path) from attendance in ≤2 taps; self_assigned places instantly.
- **Rollback:** feature-flag the new decision sheet; fall back to current buttons.
- **Risks:** removing `AddSubForMe` before Play/Tournament are migrated — scope removal to league surfaces only.

### Phase 4 — Home Action Center & browse
- **Goals:** `loadActionItems` + "Needs Your Attention"; matched-opportunity cards + eligibility/matching loader; `/subs` (Open / My accepted / My requests); realtime.
- **Files/systems:** `lib/home/actionItems.ts` (new); `lib/subs/matching.ts` (new server matcher); `app/(app)/home/page.tsx` (insert section, fix legacy-rating drift); shared `ActionItem` card; `/subs` route; `RealtimeRefresh`; `lib/realtime/topics.ts` (+`subRequestsTopic`).
- **Migrations:** none.
- **Dependencies:** Phases 1–3.
- **Security:** matched pool built server-side (service role for ratings/conflicts); honor `open_to_subbing`/`discoverable`/`dummy`; PII-safe cards.
- **Tests:** matcher hard-gates + ranking on representative players; ordering; empty/overflow; mobile+desktop; realtime removal after another player accepts.
- **Acceptance:** an opted-in eligible player sees a matched card seconds after a request opens; accepting from Home works; "See all" opens `/subs`.
- **Rollback:** section is additive; can hide behind a flag.
- **Risks:** Home density / matching precision — bound to top-N + "See all", start conservative, log matches to tune.

### Phase 5 — Withdrawal, expiration, shared links & notification polish
- **Goals:** withdrawal + reclaim UX; expiration cron; shared-link → login → return; full notification fan-out with opt-in gating; optional system chat line.
- **Files/systems:** withdraw/reclaim UI; `app/api/cron/sub-expirations` (reuse `flex-deadlines`/`reapAbandonedOrders` patterns, `CRON_SECRET`, `vercel.json`); `/subs/[id]` shareable route + logged-out return flow; notification routes; optional `message_type='system'` insert.
- **Migrations:** none (unless pulling the `message_type` column forward for system messages).
- **Dependencies:** Phases 1–4.
- **Security:** cron guarded; notifications respect opt-in; shared link reveals only non-PII opportunity context until login.
- **Tests:** expiry closes open + notifies; withdrawal reopens + notifies; logged-out link returns to the opportunity post-auth; no duplicate notifications on retry; opted-out players get zero proactive pings.
- **Acceptance:** unfilled requests expire cleanly at cutoff; a shared link converts a logged-out user through signup into the accept flow.
- **Risks:** Hobby-plan daily-cron limit (mirror the multi-division-cart note); notification noise (opt-in gate).

### Phase 6 — Cleanup & retirement
- **Goals:** remove dead paths; finalize one model.
- **Files/systems:** delete league-facing `sub_nominations` UI reach; retire `SessionSubList` toggle; remove deprecated notification kinds/statuses from code; fix comments/docs; delete legacy `league_sub_requests` claim/approve code.
- **Migrations:** optional — drop deprecated columns only after a soak period.
- **Dependencies:** Phases 1–5 stable in prod.
- **Tests:** no references to removed paths; league sub UX has a single model.
- **Acceptance:** grep shows no live dual-path league sub code; docs updated; CLAUDE.md "Current State" reflects the unified system.
- **Risks:** premature deletion — keep deprecated columns until confident.

### Later — Official league announcements
Separate phase (per decision #12). One chat + `message_type='announcement'` column on `league_messages`, organizer-gated server route, pinned/emphasized styling, higher-priority `createNotifications`, unread-announcement → Action Center item, later targeting (division/session). **Tiny foundational hook now:** none required — the Action Center's typed `ActionItem` already accommodates an `unread_announcement` type when it lands.

---

## 10. MVP vs later

- **Required first release (Phases 1–4):** unified `league_sub_requests`, atomic accept+placement (RR/box/ladder), the "Can't make it?" both-paths flow, requester status, Home "Needs Your Attention" matched cards, `/subs`. Standings/credit preserved.
- **Next useful (Phase 5–6):** withdrawal/reclaim, expiration cron, shared links, full notification fan-out + opt-in tuning, cleanup/retirement, `player_availability` ranking.
- **Deliberately deferred:** Team/Flex/Tournament/Play subs; announcements; calculated-Score/radius matching; multi-sub-per-occasion; history/filter screens; per-category notification prefs; organizer-approval mode.

---

## 11. Acceptance checklist (to approve the finished implementation)

- [ ] One `open` request per covered player per occasion (dedupe index enforced).
- [ ] Two simultaneous accepts → exactly one `filled`; the other gets 409.
- [ ] `filled` ⟺ a placement row exists (never diverges); a forced placement failure leaves the request `open`.
- [ ] Placement sets `sub_for_session_player_id` (RR) / `subbing_for_registration_id` (box/ladder) + covered `has_sub`.
- [ ] Standings: sub earns points, covered player capped at `sub_credit_cap`, sub's stats correct, public-standings parity, corrected results recompute.
- [ ] Withdrawal before cutoff reverses placement + reopens the same request atomically; notifies.
- [ ] Requester reclaim before generation removes the sub + cancels; after generation requires organizer.
- [ ] Only requester/organizer can cancel; only `filled_by` can withdraw; only eligible can accept; client cannot bypass.
- [ ] "Can't make it?" → both fulfillment paths in ≤2 taps; self_assigned places instantly.
- [ ] Home shows matched opportunities (opted-in, eligible), ordered by urgency; claimed opportunity disappears live for all viewers; empty state hides the section.
- [ ] `/subs` shows Open / My accepted / My requests.
- [ ] Notifications: requester on fill, sub confirmation, organizer visibility, withdrawal notices; no duplicates on retry; opted-out get no proactive pings; chat is never required.
- [ ] Only one league substitute mental model remains in the UI.

---

## 12. Decisions — RESOLVED (approved)

All four are locked and incorporated above:

1. **Proactive-surfacing = hybrid opt-in.** `open_to_subbing` (opt-in) gates **Home substitute cards + proactive notifications**; `/subs` stays browsable by **every eligible player** regardless. MVP: the **single** preference controls both; granular per-channel/per-category settings deferred. → §4.2, §6, §7.
2. **Skill/rating = ranking + warning, not a hard gate.** A lower-rated player may accept; the UI shows the **recommended level** and **warns on a meaningful mismatch**. Hard gates = format, required division gender, schedule conflict, duplicate participation, account eligibility (incl. suspension), operational placement guard. → §6.
3. **Withdrawal cutoff = session/period start (no 2h buffer).** Self-service withdraw until start, atomically reversing placement + reopening the same request; after start → organizer action. → §2.4, §5.1.
4. **Known-sub enforces the same HARD gates; the requester cannot override.** Organizers may override the **soft** subset (rating mismatch, missing rating, logistical warnings) with an explicit confirmation + `audit_log` entry (`placed_with_override`); integrity/suspension, duplicate placement, and post-generation guards are **non-overridable**. → §2.1, §2.6, §4.1, §6.

**No decisions remain that block implementation. The plan is ready for coding.** (Not yet started — awaiting the go-ahead.)

---

## Recommended implementation sequence
Phase 1 (domain + migration) → Phase 2 (atomic accept/placement RPCs + tests) → Phase 3 (request flows) → Phase 4 (Home Action Center + /subs) → Phase 5 (withdrawal/expiration/links/notifications) → Phase 6 (cleanup) → Later (announcements). Do not start Phase 2 UI work before the concurrency tests in Phase 2 pass.
