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

## 5. Current State — Verified June 18, 2026

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
- **Bracket correctness (June 17, 2026)** — single elimination now distributes byes across the bracket (no phantom "BYE vs BYE"; non-power-of-2 fields get proper player-vs-BYE auto-advances), and the bulk `generate-all` path respects locked seeds + dedupes via the shared `buildMatches`. **Double elimination** got a full **losers-bracket rewrite** plus the if-necessary **bracket reset** — the winners-bracket-final loser now drops into the LB final, and the LB champion must beat the undefeated WB champion twice. Verified end-to-end by a full-bracket simulation for 4/8/16-team fields (`lib/tournament/__tests__/{doubleElimSimulation,bracketReset,bracketByes}.test.ts`). **Known limitation:** non-power-of-2 double elim (byes — 6/10/12 teams) is NOT verified end-to-end yet; use 4/8/16-team fields for double elim until it is.
- **Print-ready bracket export (June 17, 2026)** — the organizer **Export** quick action (Live view) opens `/tournaments/[id]/print`, a print-optimized page that renders every active division's bracket (reuses `BracketView`, read-only) for Save-as-PDF / printing — landscape, white background, one division per page, auto-opens the print dialog.
- **Schedule Builder — draft scheduler hardening + inline controls (June 18, 2026)** — the greedy per-block draft scheduler (`lib/tournament/scheduleGenerator.ts`) now: holds later-round matches until their feeder rounds finish (per-division dependency floor, so no "TBD vs TBD" at the same slot as round 1), keeps a division clustered **on its own courts** for later rounds, prevents court double-booking across overlapping blocks, and no longer crashes on a midnight time overflow. Pinned by `lib/tournament/__tests__/scheduleGenerator.test.ts`. The Builder **preview** gained **inline draft controls**: per-division **Regenerate** (rebuilds just that division by re-packing its whole block) and inline **edit** of a draft match's court/time (✎) in all three views; the generate/regenerate POST now returns a **lean summary** and the builder **refetches drafts via GET**. Preview UX: date column in By Court/By Division, By Time sorted by court within each slot, and a warning when two blocks share courts at overlapping times.

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

*Last verified against repo: June 18, 2026*
