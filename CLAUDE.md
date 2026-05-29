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
| In-app notifications | Not yet implemented — no `notifications` table, no push, no deep links, no preferences |
| Payments | Stripe Checkout for tournaments / leagues / events; Stripe Connect Express for organizer payouts; refunds with reverse-transfer; tournament discount codes |

**Do not introduce:** shadcn/ui, Radix, Redux, tRPC, Prisma, custom ORMs, Docker, CI pipelines beyond Vercel default.

---

## 5. Current State — Verified May 29, 2026

For specific schema details, check Supabase Table Editor. For specific route details, check the codebase. This section captures **what's shipped vs. not** at the phase level — not column-level detail.

### Shipped

- **Coordination MVP** — working in production
- **Tournaments product** — divisions, registration (solo + team), partner invites, brackets, live scoring, check-in (incl. QR), match reschedule, waitlist with auto-promote
- **Leagues product** — registration, rosters, weekly sessions, attendance, substitute pool + sub-request flow, scoring, standings, group chat
- **Payments** — Stripe Checkout end-to-end; Stripe Connect Express onboarding for organizers; destination charges route fees to the organizer's account with `on_behalf_of`; refunds reverse the transfer and refund the application fee; tournament-level discount codes
- **Tournament organizer tools** — co-organizer + volunteer roles via `tournament_staff`, CSV team import, organizer-driven match reschedule, organizer-driven withdrawals with waitlist promotion
- **Transactional email** — Resend integration covering registration confirmation, payment confirmation, refund notice, solo partner-match notification, sub-request flow, daily session reminders (cron), and organizer-to-bracket announce
- **Two-form-factor refactor Slices 0–6** — all desktop-canonical routes shipped: primitives, tournament create/manage/sub-routes, league create/manage/sub-routes (standings/roster/edit)
- **Audit log scaffold** — `audit_log` table + `lib/audit/log.ts` helper. Wired into the match score and match ready routes; other state transitions still TODO.
- **Partner mode setting (Fixed vs Rotating)** — tournaments + leagues both expose an organizer toggle on doubles divisions/formats. Leagues: `leagues.partner_mode` enum; scheduler honors `partner_user_id` cross-links in fixed mode. Tournaments: support rotating for `round_robin` bracket type only (`tournament_divisions.partner_mode`; `tournament_matches.team_*_partner_registration_id` columns hold the 4-player layout).

### Not yet built

- **Unified `competitions` schema** — designed in @docs/architecture-target.md, not migrated
- **In-app notification center** — no `notifications` table, no push, no deep links, no preferences. Transactional email exists via Resend but there is no in-app inbox.
- **SMS** — no Twilio / equivalent
- **DUPR integration** — no API connection, no per-division min/max rating
- **Audit log on every state change** — table + helper exist; only the match score and ready routes are wired so far. Remaining: tournament create, registrations, refunds, division edits, withdrawals, league transitions.
- **Platform stats** (`platform_stats_mv` materialized view)
- **Players directory** beyond basic profiles
- **Public marketing site overhaul** (per-court SEO pages, public browse, etc.)
- **Organization / business layer** — every tournament + league is owned by a single individual organizer; no `organizations` table, no multi-tournament business accounts, no business public pages

### In progress

- **Two-form-factor refactor** — code complete. QA pass at 375 / 768 / 1280px pending (Marty).

---

## 6. Open Decisions

These are the actual unresolved decisions blocking informed choices:

- **Schema reconciliation.** Live DB has separate `tournaments` and `leagues` domains. A unified `competitions` schema has been designed but not built. Path A (keep separate) vs. Path B (unify) — deferred until an organizer has been spoken to. Design in @docs/architecture-target.md.
- **First committed event.** None. No organizer has seen the product yet.
- **Organizer conversation.** Not yet booked. Blocking informed product decisions on Path A vs. B.

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

---

## Quick Links

- Two-form-factor refactor plan: `/docs/phases/two-form-factor.md`
- Target architecture (aspirational): @docs/architecture-target.md
- Security rules: @docs/security.md

---

*Last verified against repo: May 29, 2026*
