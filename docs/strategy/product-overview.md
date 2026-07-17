# Joinzer — Product Overview

_Last updated: July 17, 2026_

> A narrative, phase-level snapshot of what exists — the "what's shipped vs. not" without the column-level detail that drifts. For the authoritative, current picture, the **codebase**, **Supabase Table Editor**, and **`CLAUDE.md`'s "Current State"** win. If this doc and the code ever disagree, the code is right.
>
> Confidence: shipped capabilities are ✅ validated (they run in production); "not built" items are 🔵 grounded (confirmed absent as of this date).

## What Joinzer is (one line)

A mobile-first pickleball platform with four surfaces — **Coordination, Leagues, Tournaments, Players** — sharing one app, one auth, and one database. (See `vision-and-strategy.md` for the why.)

## The four surfaces and their maturity

- **Coordination (Play)** — ✅ working in production. Players create, discover, and join local play sessions. The original MVP.
- **Tournaments** — ✅ deep and shipped. Divisions, solo + team registration, partner invites, brackets (single/double elim, round-robin, pool→playoffs), live scoring, check-in (incl. QR), match reschedule, waitlist with auto-promote, an advanced schedule builder, print/export, and an offline run mode.
- **Leagues** — ✅ deep and shipped. Registration, rosters, weekly sessions, attendance, substitutes, scoring, standings, group chat, CSV import, and **five formats** (see below).
- **Players** — ✅ shipped. A searchable directory with filters, individual public profiles that read as **player résumés** (rating, career stats, recent form, titles/podiums, upcoming events), plus privacy controls and an organizer-identity page.

## Shipped capabilities (grouped)

- **League formats (all five):** Round Robin (session), Box, Ladder, Team, and Flex. Team and Flex sit behind feature flags. Flex was the first player-driven format (self-scheduled, report + confirm).
- **Payments:** Stripe Checkout end-to-end; Stripe Connect Express for organizer payouts; destination charges with a platform fee; refunds with reverse-transfer; discount codes; **multi-division cart** with bundle discounts; early-bird tiered pricing; a **paid-event gate** (charging money requires manual organizer approval).
- **Ratings:** a calculated **Joinzer Score** (0–100) + **Joinzer Level** (activity label), powered by a Glicko-2 engine, player-visible when earned; DUPR is a secondary, never-manually-verified signal. Nightly recompute cron.
- **Substitutions:** a complete, unified league substitution system — request a sub / accept an open opportunity / organizer assignment — with atomic accept + placement, a discovery surface (`/subs`), and a full lifecycle (withdraw/reclaim/reopen/expire). (Six phases, done.)
- **Player-run play:** player self-substitutions, player self-scoring, captain self-service for team leagues, and **player-run leagues** (a round-robin session can run without a court monitor).
- **Realtime:** a reusable event-driven layer (shared socket, refcounted channels) driving live chat, attendance, scores, standings, the notification bell, and a live home Action Center.
- **Notifications:** in-app notification center (bell + panel, deep links, 12+ triggers) and live browser push.
- **Organizer tools:** co-organizer + volunteer roles, CSV import, reschedule, withdrawals with waitlist promotion, setup checklists, a guided first-event onboarding funnel.
- **Locations/venues:** organizers can add off-directory venues (pending → admin approval), with map + geocoding.
- **Transactional email** (Resend) and an **audit log** for sensitive state changes.
- **Home screen:** a server-derived, urgent-first "Needs your attention" Action Center (dual-audience: player + organizer), My Schedule, and ranked Upcoming Events — live-refreshed.

## Cross-cutting systems worth knowing

- **Two form factors:** setup surfaces are desktop-first; day-of and player-facing surfaces are mobile-first.
- **Security model:** RLS deny-all + service-role writes inside API routes — the route is the authorization boundary. (See `docs/security.md` and `decision-log.md`.)
- **Offline run mode:** a single organizer can run an entire tournament with no connectivity (IndexedDB + outbox + reconcile).

## Not built / deferred (🔵 as of this date)

- **Unified `competitions` schema** — designed (`docs/architecture-target.md`), not migrated. Tournaments and leagues remain separate domains. (See Path A/B in `open-decisions.md`.)
- **Organizations / business layer** — every event is owned by a single individual; no org accounts, no multi-tournament business entity.
- **SMS** — none.
- **DUPR API sync** — no live API connection (manual entry only); needs a partner contract.
- **Per-court SEO pages** — ~65 courts in the DB, no public `/courts/[slug]` pages yet.
- **Multi-sport** — the architecture is activity-aware, but pickleball is the only sport.
- **Full public browse** (deep filtering, map view, per-court pages) — basic browse is shipped; the rich version is future.

## How to get current detail

This doc is intentionally high-altitude. For specifics: routes → the codebase; schema/columns → Supabase Table Editor; the phase-by-phase shipped/not-shipped ledger → `CLAUDE.md`; design intent for a given system → `docs/phases/`.
