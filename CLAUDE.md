# CLAUDE.md — Joinzer

> Read at session start. Reality file: describes what is actually built and how we work.
> For target architecture (aspirational), see @docs/architecture-target.md.
> For security rules, see @docs/security.md.

---

## 1. What We're Building

**Joinzer** is a mobile-first pickleball platform with **four product surfaces** sharing one app, one auth, one database:

1. **Coordination** — players create, discover, and join local play sessions. Original MVP.
2. **Leagues** — recurring competitive play with persistent rosters, weekly sessions, season standings.
3. **Tournaments** — discrete events with divisions and registrations.
4. **Players** — searchable directory with profiles, ratings, history, connections.

**Pilot market:** Las Vegas metro (Henderson, Summerlin, Green Valley, North Las Vegas).

All four surfaces share users, profiles, locations. Bottom nav: Home / Play / Leagues / Tournaments / Players / Profile.

---

## 2. Product North Star

- **Coordination:** Player-first. Speed of "find a game and show up" is the metric.
- **Leagues:** Organizer-and-captain-first. Season reliability and roster fairness.
- **Tournaments:** Organizer-first. Tournament-day reliability and the player↔organizer loop.
- **Players:** Discovery-first. Finding the right partner, opponent, or community.
- Setup surfaces are desktop-first. Day-of and player-facing surfaces are mobile-first.
  See `/docs/phases/two-form-factor.md`.

---

## 3. Build Philosophy

- Small, focused changes. Preserve working code.
- Read existing code before changing it.
- One concern per slice. Data model changes and layout changes do not share a PR.
- If a doc claim contradicts the codebase, **the codebase wins.** Flag it immediately and stop.

---

## 4. Stack (Actual)

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript strict |
| Styling | Tailwind CSS only (no shadcn/ui, no Radix) |
| Icons | lucide-react |
| Backend | Supabase (Postgres + Auth + RLS) |
| Auth | Production: email/password + Google OAuth |
| Hosting | Vercel (frontend) + Supabase (backend) |
| Transactional email | Resend (registration / payment / refund / partner-match / sub-request / session-reminder / organizer announce) |
| In-app notifications | Implemented — `notifications` table, bell + panel in app header, deep links, 12+ triggers wired. Browser push is code-complete but **not enabled** (VAPID keys unset — see Current State). |
| Payments | Stripe Checkout for tournaments / leagues / events; Stripe Connect Express for organizer payouts; refunds with reverse-transfer; tournament discount codes |

**Do not introduce:** shadcn/ui, Radix, Redux, tRPC, Prisma, custom ORMs, Docker, CI pipelines beyond Vercel default.

---

## 5. Current State — Verified July 2, 2026

For specific schema details, check Supabase Table Editor. For specific route details, check the codebase. This section captures **what's shipped vs. not** at the phase level — not column-level detail.

### Shipped

- **Coordination MVP** — working in production
- **Tournaments product** — divisions, registration (solo + team), partner invites, brackets, live scoring, check-in (incl. QR), match reschedule, waitlist with auto-promote
- **Leagues product** — registration, rosters, weekly sessions, attendance, substitute pool + sub-request flow, scoring, standings, group chat
- **Payments** — Stripe Checkout end-to-end; Stripe Connect Express onboarding for organizers; destination charges route fees to the organizer's account with `on_behalf_of`; refunds reverse the transfer and refund the application fee; tournament-level discount codes
- **Tournament organizer tools** — co-organizer + volunteer roles via `tournament_staff`, CSV team import, organizer-driven match reschedule, organizer-driven withdrawals with waitlist promotion
- **Transactional email** — Resend integration covering registration confirmation, payment confirmation, refund notice, solo partner-match notification, sub-request flow, daily session reminders (cron), and organizer-to-bracket announce
- **Two-form-factor refactor Slices 0–6** — all desktop-canonical routes shipped: primitives, tournament create/manage/sub-routes, league create/manage/sub-routes (standings/roster/edit)
- **Audit log** — `audit_log` table + `lib/audit/log.ts` helper. Wired into: match score, match ready, match reschedule, registration cancel/withdraw/refund, league sub request claim/approve/cancel. Still unwired: tournament/league create, division edits.
- **Partner mode setting (Fixed vs Rotating)** — tournaments + leagues both expose an organizer toggle on doubles divisions/formats. Leagues: `leagues.partner_mode` enum; scheduler honors `partner_user_id` cross-links in fixed mode. Tournaments: support rotating for `round_robin` bracket type only (`tournament_divisions.partner_mode`; `tournament_matches.team_*_partner_registration_id` columns hold the 4-player layout).
- **Email log** — `email_log` table; all transactional emails logged via `lib/email/send.ts` (recipient, subject, Resend ID, status).
- **Fixed-partner assignment UI** — Roster page shows "Team X/Y" pairs for fixed-partner leagues; organizer assigns/changes via `/api/leagues/[id]/assign-partner`. Teams shown in attendance and match cards in Live Session Manager.
- **Tournament division defaults** — Create Tournament sets default format (round robin/single/double elim), points-to-win (11/15/21), win-by (1/2), and primary venue. Divisions inherit all and can override. Columns: `tournaments.default_win_by`, `tournaments.default_games_to`, `tournaments.default_bracket_type`, `tournament_divisions.location_id`.
- **Gender validation** — All tournament registration paths enforce gender for mens/womens divisions (RPC + route + auto-pairing). League roster add-player dropdown filters by gender for gender-specific formats.

- **In-app notification center** — `notifications` table + RLS + indexes. Bell + panel in app header (all breakpoints). Deep links per notification. 12+ triggers wired across tournaments, leagues, Stripe webhook, cron.
- **Browser push — code-complete but NOT enabled** — full implementation exists: `profiles.push_subscription` column (migration `20260601000001`), service worker (`public/sw.js`), subscribe/unsubscribe API (`app/api/push/subscribe`), VAPID sender with expired-subscription cleanup (`lib/push/send.ts`), `PushSubscribeButton` mounted in Profile + NotificationPanel, and `sendPush`/`sendPushBatch` wired into `lib/notifications/create.ts` so every in-app notification also fires a push. **It silently no-ops because VAPID env vars are unset** (`NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — absent from `.env.local.example`). To turn on: generate VAPID keys, set the three env vars in Vercel + local, add them to `.env.local.example`.
- **Players directory** — `/players` with search, skill/gender filters, availability. `/players/[id]` individual profile page. Cards link to profiles; invite-tap still works when player is available.
- **Public browse pages** — `/browse/leagues` and `/browse/tournaments` accessible without auth. LandingNav/Footer shell. Middleware allowlisted. CTAs on landing page link directly to browse.
- **Marketing site** — updated hero ("Play. Compete. Find your game."), trust strip, CompeteSection CTAs, login tagline. OrganizersSection added (PR #39).
- **Advanced Schedule Builder** — merged to main and live on Vercel (PR #58). Organizer surface at `/tournaments/[id]/schedule/builder`: define date/time/court "blocks", drag divisions into them, see capacity + player-conflict warnings, then generate a draft match schedule (greedy per-block scheduler), preview by time/court/division, and publish. Draft matches carry `tournament_matches.is_draft=true` and are filtered out of all participant/organizer reads until published. Schema migration `20260615000001_advanced_schedule_builder` applied to prod (`tournament_schedule_blocks`, `tournament_division_blocks`, `tournaments.schedule_settings_json`, `tournament_matches.schedule_block_id`+`is_draft`). MVP limitation: elimination BYE auto-advance not applied to drafts. Builder division drag-and-drop uses `@dnd-kit` (pointer + touch + keyboard sensors; dropdown fallback retained) — the old native HTML5 DnD didn't work on touch and was unreliable cross-browser. The legacy one-click per-division "Generate Matches" flow is unchanged and coexists. Schedule generation now lives in two places: the Schedule Builder and the per-division "Generate Matches" flow (division Manage). The tournament-level one-click **"Generate Full Tournament"** card (`ScheduleGenerator`) was **removed June 17, 2026** to consolidate scheduling into those two surfaces — the card was unmounted from the organizer overview and the component file deleted. The non-functional "Reschedule" quick-action chip (placeholder "coming soon" toast) was removed from the organizer Live view at the same time — per-match reschedule still lives on the Schedule tab.
- **Bracket correctness (June 17, 2026)** — single elimination now distributes byes across the bracket (no phantom "BYE vs BYE"; non-power-of-2 fields get proper player-vs-BYE auto-advances), and the bulk `generate-all` path respects locked seeds + dedupes via the shared `buildMatches`. **Double elimination** got a full **losers-bracket rewrite** plus the if-necessary **bracket reset** — the winners-bracket-final loser now drops into the LB final, and the LB champion must beat the undefeated WB champion twice. Verified end-to-end by a full-bracket simulation for 4/8/16-team fields (`lib/tournament/__tests__/{doubleElimSimulation,bracketReset,bracketByes}.test.ts`). **Non-power-of-2 double elim (byes) is now verified end-to-end too** — `doubleElimNonPow2.test.ts` plays out every field size 4–32 (single champion, everyone else eliminated at exactly two losses, reset included), and `playoffPlaceholders.test.ts` does the same for the up-front placeholder double-elim bracket (pool playoffs) at sizes 5–12 incl. the if-necessary reset.
- **Print-ready bracket export (June 17, 2026)** — the organizer **Export** quick action (Live view) opens `/tournaments/[id]/print`, a print-optimized page that renders every active division's bracket (reuses `BracketView`, read-only) for Save-as-PDF / printing — landscape, white background, one division per page, auto-opens the print dialog.
- **Schedule Builder — draft scheduler hardening + inline controls (June 18, 2026)** — the greedy per-block draft scheduler (`lib/tournament/scheduleGenerator.ts`) now: holds later-round matches until their feeder rounds finish (per-division dependency floor, so no "TBD vs TBD" at the same slot as round 1), keeps a division clustered **on its own courts** for later rounds, prevents court double-booking across overlapping blocks, and no longer crashes on a midnight time overflow. Pinned by `lib/tournament/__tests__/scheduleGenerator.test.ts`. The Builder **preview** gained **inline draft controls**: per-division **Regenerate** (rebuilds just that division by re-packing its whole block) and inline **edit** of a draft match's court/time (✎) in all three views; the generate/regenerate POST now returns a **lean summary** and the builder **refetches drafts via GET**. Preview UX: date column in By Court/By Division, By Time sorted by court within each slot, and a warning when two blocks share courts at overlapping times.
- **Offline tournament run mode — code-complete, pending real-device QA (July 1, 2026)** — a single organizer on one device can run an **entire** tournament with **no connectivity**. Surface: `/tournaments/[id]/run` (`<RunMode>`), reached via **"Run offline"** in the organizer manage nav. Open it once online → the whole tournament (divisions, matches, registrations) is hydrated into **IndexedDB** (`lib/offline/tournamentDB.ts`, whole-tournament store); go fully offline → the `/run` page **cold-loads** from the service-worker cache and reads IndexedDB. Offline you can **score** (reuses the Phase-1 `BracketView` local-advance engine), **check players in**, **seed playoffs from standings**, and **reschedule** court/time — each op applies to the store immediately and queues in a unified **outbox** (`lib/offline/outbox.ts`, IndexedDB FIFO, dedupe-by-key). On reconnect, `lib/offline/reconcile.ts` drains scores→outbox FIFO and, **only when fully drained**, bulk-refetches and replaces the store (so it never clobbers un-synced writes; server-assigned ids like the double-elim reset row become authoritative). New organizer check-in route `PATCH /api/tournaments/[id]/registrations/[regId]/checkin` (`canOperate`-gated, idempotent). Generation stays an **online setup** action — offline run mode only scores/seeds/checks-in/reschedules an already-generated tournament (up-front placeholder brackets mean the whole bracket already exists). **Offline is lead-organizer only (Phase 3, Option 1):** the "Run offline" nav entry shows for the tournament owner only, and `<RunMode>` is **read-only for co-organizers/volunteers** (`offline-bundle` returns `is_lead_organizer`; a banner points non-leads to the live view) — so there's exactly **one offline writer per tournament** and the single-writer reconcile stays sound. Migration `20260626000003_add_playoff_slot_sources` (`tournament_matches.team_1_source`/`team_2_source` jsonb) is applied to prod. Full design + build order in `docs/phases/offline-run-mode-phase-2.md` (Phase 1: `offline-scoring-phase-1.md`; multi-writer design: `offline-multi-device-phase-3.md`). **Not yet enabled beyond code:** needs a manual airplane-mode pass on a real phone against the Phase-2 acceptance criteria. **Full multi-device / co-organizer offline (concurrent writers + conflict resolution) is Phase 3, Option 2 — designed, deferred** until a multi-court no-signal event needs it.

- **Rolling Schedule mode (July 2, 2026, PR #177)** — a second scheduling method alongside the original **Timed** (`tournaments.scheduling_method` enum, `'timed'` default | `'rolling'`; toggle on Create/Edit). **Rolling** has no clock times after the first round: matches carry a tournament-wide **Match #** (`tournament_matches.sequence_number`, nullable, shown in **both** modes) and are called by number as courts free up. Generation lives in `lib/tournament/schedule/`: `buildRollingSchedule` reuses the extracted, behavior-preserving `orderByDependency` (from `scheduleGenerator`), distributes matches round-robin across a block's courts **capped at peak concurrency** (a 6-player RR uses 3 courts even if the block offers more), stamps the block start time on the **first match of each court** (rest untimed), and `assignSequenceTimed`/`assignSequenceInOrder` assign the stable 1..N Match # **once at generation** (never on reschedule). `generate-schedule` branches on `scheduling_method`. Rolling **reuses the Advanced Schedule Builder** (time-interval settings + block End hidden; block Start = "first matches start at"). Display: `BracketView` shows a "Match N" chip and renders a match time only when present (via IsRolling threading, now presence-based); organizer Schedule tab gains a "By Match #" view; LiveScoreboard shows "Court n · Match k"; SchedulePreview shows a "By Match #" ordered list. **Timed is unchanged** — every gate defaults to timed, `sequence_number` is additive/nullable (existing tournaments untouched until regenerated), and the `orderByDependency` extraction is pure ordering (existing scheduler tests unchanged). Migration `20260702000001_rolling_schedule` applied to prod. Architecture is extensible to a future **Hybrid** (add to the `SchedulingMethod` type + the one generation branch). Match Number is now first-class for **both** methods (TDs reference "Match 17"). Scheduling method is also a **per-division override** (PR #182): nullable `tournament_divisions.scheduling_method` (null → inherits the tournament) with a "Scheduling" selector on the division add/edit forms, so a rolling tournament can host a timed division and vice versa; `generate-schedule` splits each block by the division's *effective* method (timed rows → `scheduleBlockMatches`, rolling rows → `buildRollingSchedule`) into one dense tournament-wide Match #. Live **court board** on the public scoreboard for rolling tournaments (per court: "In Progress: Match N / Next: Match M", auto-advances via realtime). "Run offline" is signposted (nav "Run offline (no wifi)" + in-page explainer; lead-organizer only).

- **Show seed numbers setting (July 2, 2026, PR #184 + #185)** — organizer toggle to display or hide seed labels (#1, #2…) next to teams/players. Tournament-level default set on Create/Edit (`tournaments.show_seeds` boolean, default `false`) that becomes the default for every division, with a nullable per-division override (`tournament_divisions.show_seeds`; null → inherits the tournament). Effective value everywhere = `division.show_seeds ?? tournament.show_seeds`, applied consistently across **all** views — brackets, Schedule, Scores, Export/print, and offline Run mode — via `BracketView`'s `showSeeds` prop (previously the export hardcoded seeds on). The division-page SeedingPanel checkbox now persists the per-division override server-side (replaced the old per-browser localStorage toggle). Migration `20260702000003_show_seeds_setting` applied to prod. **Auto-seed (PR #185):** because "Show seed numbers" is only a *display* toggle and seeds were previously written only by the manual "Save Seeds" flow, turning it on but never seeding left every `seed` null → nothing rendered. Now, when a division's effective `show_seeds` is on and no seeds were set manually, all three generation paths (per-division `generate-matches`, Schedule Builder `generate-schedule`, bulk `generate-all`) persist seeds 1..N in **bracket-build order** via the shared `lib/tournament/autoSeed.ts` `persistAutoSeeds` (`buildDivisionMatchRows` now also returns the team build-order + whether explicit seeds existed). Manually-seeded fields are untouched; rotating-doubles is skipped. The Schedule Builder draft preview also prefixes `#N` on team labels when the division shows seeds. Existing tournaments generated before this won't retro-fill until re-generated. Nullable division column → existing tournaments unchanged (seeds hidden by default).

- **Box leagues + unified attendance (July 6, 2026, PRs #225–#236)** — **Box leagues** (`leagues.format_kind='box'`) run tiered boxes per **cycle** (`league_periods` / `league_boxes` / `league_box_members`), round-robin `league_fixtures`, promotion/relegation, and per-cycle standings (results grouped by round). The organizer runs a box league entirely from the **Run Session** surface (`/leagues/[id]/attendance`, always shown for box admins via `lib/leagues/runSession.ts` `getRunSessionAction`), which is the box hub in order: **(1) seed** — pick the **number of boxes** on game day (there is *no* create-time box size); players auto-fill evenly via `lib/leagues/boxAssignment.ts` `distributeIntoBoxes` (sizes differ by ≤1, remainder to the top boxes — 13→5/4/4; stored as `format_settings.num_boxes`), shown only until matches are scored; **(2) attendance + subs**; **(3) generate + score matches**; **(4) advance** the cycle (promotion/relegation carries the box count forward). The **Roster** page is registration-only. The round-robin **attendance grid + substitute flow** (Here / Coming / Late / Can't Come / Sub / Not Here) is **shared across formats** via `components/features/leagues/AttendanceGrid.tsx` (normalized `AttendeeRow[]` + the pure `buildAttendeeRows` sub-overlay resolver in `lib/leagues/attendance.ts`), backed by the format-agnostic **`league_attendance`** table (occasion = session XOR cycle `period_id`; attendee = registration / user / guest; RLS deny-all + service role). Box members are grouped by box; a sub's fixture results credit the covered **registration** so standings/promotion stay correct with no scoring change. Round-robin still stores attendance on `league_session_players` (intentionally **not** migrated onto `league_attendance` — rationale in `docs/phases/unified-attendance.md`). v1 attendance/subs are **entrant-level** (a team in doubles, a player in singles). Design: `docs/phases/unified-attendance.md`, `docs/phases/league-formats.md`.

- **Ladder League (July 7, 2026)** — a third league format (`leagues.format_kind='ladder'`) alongside Round Robin and Box: a season-long **continuous ranking** (`ladder_positions`, `1..N`) updated after **king-of-the-court** nights, with rank **trend** (`ladder_position_history`). Distinct from Box on purpose (Box = tiered round-robin groups; Ladder = adjacent, movement-based rank). Each session is a `league_periods` row (`period_kind='ladder_session'`); per-court games reuse `league_fixtures` (`round_number` + `court_number`, `match_stage` `ladder_round`/`ladder_bye`); attendance/subs reuse `league_attendance`. **Play:** entrants (singles or fixed-partner doubles teams) seed onto **courts of 2** by rank (round 1), then each round the **winner moves up a court / loser down** (`rounds_per_session`, default 6). **Movement:** after the night, bounded — a player moves **≤ `max_move`** spots (default 3) toward the night's win-% order (`computeFixtureStandings`), via odd-even transposition; **absent entrants hold rank**, a **sub plays for the covered entrant's spot**. The organizer confirms via a **preview → Finalize** step (no auto-mutation). Pure engine in `lib/leagues/ladder.ts` (initial ranking, `seedKotcRound`/`nextKotcRound`, `boundedMovement`, `reintegrateRanking`; 16 tests); server reads/finalize in `lib/leagues/ladderServer.ts`. Surfaces: Create/Edit format option + settings; Roster hosts the drag-to-order editor (`POST /ladder/rank`); Run hub `/leagues/[id]/ladder` (attendance via the shared `BoxAttendanceManager`, KOTC rounds via `LadderRounds`, routes `/ladder/{start-session,round,finalize}`); Standings shows the ranking + `▲/▼` + trend `Sparkline`; overview shows the viewer's rank + tonight's court. Migration `20260707000001_ladder_league` applied to prod. **v1 limits:** no re-finalize after a session closes (correct scores first, else manual reorder on Roster); absent = hold rank only. Not reused: box `applyPromotionRelegation` (leapfrogs winners to the tier top — wrong for a continuous ladder). Design supersedes the *challenge*-ladder sketch in `docs/phases/league-formats.md §10`.

### Not yet built

- **Unified `competitions` schema** — designed in @docs/architecture-target.md, not migrated
- **Organizer onboarding flow** — no guided path from landing page → create first league/tournament. First organizer conversion is manual.
- **SMS** — no Twilio / equivalent
- **DUPR integration** — no API connection, no per-division min/max rating
- **Audit log on every state change** — table + helper exist; tournament/league create and division edits still unwired.
- **Platform stats** (`platform_stats_mv` materialized view) — `StatsSection` component exists but removed from homepage (showed 0s with no real data)
- **Per-court SEO pages** — ~65 courts in DB, no public `/courts/[slug]` pages yet
- **Public browse** — full-featured (per-court pages, deep filtering, map view) is future; basic `/browse/leagues` and `/browse/tournaments` are shipped
- **Organization / business layer** — every tournament + league is owned by a single individual organizer; no `organizations` table, no multi-tournament business accounts
- **Browser push notifications (enablement only)** — all code is built and wired (see Shipped); only the VAPID env keys remain to turn it on. Not a build task — a config task.

### In progress

- **Two-form-factor QA** — code complete and deployed. Public routes QA'd via Playwright. Authenticated desktop routes (tournaments/create, leagues/create, standings, roster) still need eyes with a real logged-in session at 375/768/1280px.

---

## 6. Open Decisions

These are the actual unresolved decisions blocking informed choices:

- **Schema reconciliation.** Live DB has separate `tournaments` and `leagues` domains. A unified `competitions` schema has been designed but not built. Path A (keep separate) vs. Path B (unify) — deferred until an organizer has been spoken to. Design in @docs/architecture-target.md.
- **First committed event.** None. No organizer has seen the product yet. Product is shippable for a demo.
- **Organizer conversation.** Not yet booked. This is the #1 blocker — it unblocks Path A vs. B, pricing, and the onboarding flow design.

---

## 7. Coding Style

- TypeScript strict mode
- ES modules, `import`/`export`
- `async`/`await`, not `.then()` chains
- 2-space indent
- Descriptive variable names; single letters only for loop counters
- Comment *why*, not *what*
- Server Components by default; `"use client"` only when needed
- Tailwind only; lucide-react for icons; no shadcn/ui
- One file = one concern; split when a file passes ~200 lines

---

## 8. Working Agreement (Joinzer-Specific)

Global rules from `~/.claude/CLAUDE.md` apply. Joinzer adds:

- If a doc claim contradicts the codebase, the codebase wins — flag and stop.
- The last step of any session that changes structure, schema, or status: update CLAUDE.md's "Current State" and verification date. **Drift is the enemy.**
- When finishing a phase or major slice: 10-minute pass through CLAUDE.md to re-verify "Current State" claims, move completed items out of "Open Decisions," update the verification date.
- Do not document fast-changing things (specific routes, specific tables, schema columns) in markdown. Point at the codebase or Supabase Table Editor instead.

### Gotchas learned in session (June 5, 2026)

**Supabase migration rule — apply BEFORE pushing code.**
New DB columns must exist in Supabase before the code that selects them is deployed. Selecting a non-existent column causes the query to return `null` → `notFound()` → 404. Apply migrations in the SQL editor first, verify, then push to Vercel.

**`sendEmail` returns `void` — never destructure `{ error }`.**
`lib/email/send.ts` wraps Resend and returns `Promise<void>`. Do NOT write `const { error } = await sendEmail(...)`. Just `await sendEmail(...)`.

**`league_matches` has no unique constraint.**
`upsert` with `onConflict` on `(session_id, round_number, court_number)` fails — no constraint exists. For edit flows, DELETE the existing row then INSERT the new one.

**`Player` type in `LiveSessionManager` uses snake_case.**
The type has `user_id` (not `userId`). All session player fields are snake_case — don't mix in camelCase.

**Supabase join type inference conflicts.**
When a query uses a foreign-key join (e.g. `profile:profiles!user_id(...)`), TypeScript may reject explicit type assertions on the result. Cast with `as any[]` first, then access fields typed as `any`.

**Fixed-partner mode only activates when pairs are linked in the DB.**
`isFixedMode` in the league scheduler is `true` only when `fixedPairs.size > 0`. If no `partner_user_id` is set in `league_registrations`, the scheduler silently falls back to rotating mode. Organizer must assign pairs via the Roster page before generating rounds.

**Dev server — `npm run dev` is webpack + polling, not Turbopack.**
Turbopack's file watcher goes stale on Windows (serves old compiled code → phantom hydration mismatches, a `(stale)` badge, old UI rendering). The default `dev` script runs `next dev --webpack` with `WATCHPACK_POLLING` for reliable HMR; `npm run dev:turbo` is the faster Turbopack path when it's behaving. If you ever see stale UI, `rm -rf .next && npm run dev`. (Added `cross-env` dev dep so the env var works in both Git Bash and PowerShell.)

---

## Quick Links

- Two-form-factor refactor plan: `/docs/phases/two-form-factor.md`
- Target architecture (aspirational): @docs/architecture-target.md
- Security rules: @docs/security.md
- Partner invite flow + required Supabase Auth config: `/docs/partner-invite-flow.md`

---

*Last verified against repo: July 7, 2026*
