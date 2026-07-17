# Joinzer — Decision Log (ADRs)

_Last updated: July 17, 2026_

> The **why** behind Joinzer's foundational choices, so they don't get re-litigated and so recommendations respect the constraints. Each entry: the decision, the context, and the consequences. These are ✅ decided (in effect today) unless marked otherwise. Genuinely *unresolved* calls live in `open-decisions.md`, not here.

## ADR-01 — Stack: Next.js + Supabase + Vercel + Stripe

**Decision:** Next.js 16 (App Router) + React 19 + TypeScript strict; Tailwind only; Supabase (Postgres + Auth + RLS); Vercel hosting; Stripe for payments; Resend for email.
**Context:** a solo builder who is strong with AI-assisted development needs a stack that's productive, well-documented, and low-ops.
**Consequences:** fast to build and deploy; minimal infra to run; heavy reliance on Supabase and Vercel primitives. Server Components by default; `"use client"` only when needed.

## ADR-02 — Explicit tech exclusions

**Decision:** do **not** introduce shadcn/ui, Radix, Redux, tRPC, Prisma, custom ORMs, Docker, or CI pipelines beyond the Vercel default. Tailwind only; lucide-react for icons.
**Context:** every added abstraction is surface area one person has to maintain.
**Consequences:** a deliberately lean, boring, legible stack. New contributors (human or AI) should match existing patterns rather than reach for familiar libraries.

## ADR-03 — Authorization model: RLS deny-all + service-role in routes

**Decision:** most tables are RLS **deny-all**; sensitive writes happen via the **service role inside API routes**, and **the API route is the security boundary** — it authenticates and authorizes before every write. A few flows use `SECURITY DEFINER` RPCs (registration, checkout, join/leave, the Stripe webhook, substitution accept/placement).
**Context:** service-role bypasses RLS, so trust must live in the route, not the client.
**Consequences:** never trust a client-supplied user id/role; re-derive server-side. A "RLS enabled, no policy" advisory on deny-all tables is expected, not a bug. Client-readable tables use least-privilege policies; sensitive columns are hidden with column-level GRANTs. (Full rules: `docs/security.md`.)

## ADR-04 — Schema: keep tournaments and leagues separate (Path A, for now)

**Decision:** tournaments and leagues remain **separate domains**; a unified `competitions` schema is designed but **not built**.
**Context:** unifying a live, feature-rich system is a large, risky migration, and the right abstraction isn't clear pre-customer.
**Consequences:** some duplicated concepts across domains, accepted deliberately. **This is a deferral, not a rejection** — the live decision is tracked in `open-decisions.md` (Path A vs. B) and the target design in `docs/architecture-target.md`.

## ADR-05 — Ratings: Joinzer Score/Level first, DUPR secondary

**Decision:** Joinzer computes its own **Score (0–100)** and **Level (label)** via a Glicko-2 engine; **DUPR is secondary and never treated as verified** unless truly verified. The architecture is **activity-aware** (pickleball first).
**Context:** owning the rating identity is strategic; depending on DUPR's API is an external dependency Joinzer doesn't control yet.
**Consequences:** Joinzer isn't blocked on a DUPR partnership; players get an earned, in-house rating. DUPR API sync remains a future, external-dependent phase.

## ADR-06 — Unified substitution model

**Decision:** one league substitution system on `league_sub_requests` with two fulfillment modes (open-pool / self-assigned) plus organizer-assigned; **no approval step by default**; acceptance = a single atomic `SECURITY DEFINER` RPC that does claim + placement in one transaction.
**Context:** two earlier half-models (a never-placing request table and a dead-approval nominations table) had to be retired — do not build a third.
**Consequences:** status and participation can never diverge; `sub_credit_cap` stays correct because shared placement primitives are the single source of truth. (`sub_nominations` now serves Play + tournaments only.)

## ADR-07 — Realtime: one reusable event-driven layer, no React Query

**Decision:** a single realtime foundation (`lib/realtime`) with a shared socket + refcounted channels + a typed topic registry. **Two delivery mechanisms:** `postgres_changes` for client-readable tables, **server Broadcast** for deny-all/sensitive tables. **No React Query.**
**Context:** per-component `supabase.channel()` calls fragmented and some silently broke; deny-all tables can't use `postgres_changes` (RLS delivers nothing).
**Consequences:** extend the layer, don't roll new channels per component. The broadcast path keeps RLS deny-all intact by emitting minimal non-PII events.

## ADR-08 — Payments: Stripe Connect destination charges + paid-event gate

**Decision:** organizer payouts via Stripe Connect Express; destination charges route funds to the organizer with a platform application fee; **creating paid events is gated behind manual approval** (`can_create_paid_events`, a "book a call" flow). Joinzer moves **no prize money**.
**Context:** organizers need to get paid cleanly; charging money is a trust/qualification checkpoint (and a pricing conversation).
**Consequences:** the mechanism to take a cut exists; the fee level and who-pays are still open (`business-model-and-pricing.md`). Prizes are display-only.

## ADR-09 — Two form factors

**Decision:** setup surfaces are **desktop-first**; day-of and player-facing surfaces are **mobile-first**.
**Context:** organizers set up at a desk; everyone plays with a phone at the court.
**Consequences:** the same feature may have distinct desktop-setup and mobile-day-of UIs. (`docs/phases/two-form-factor.md`.)

## ADR-10 — Deploy autonomy

**Decision:** for Joinzer, commit/push/merge/deploy to `main` freely — no per-push confirmation — justified by automated gates (tsc + build + tests green) and easy git/Vercel rollback.
**Context:** a solo builder shipping fast; Vercel's default pipeline is the CI.
**Consequences:** non-negotiables remain: never commit secrets; gates must be green before shipping; confirm before genuinely destructive non-git actions (dropping columns, deleting data). Migrations are applied to Supabase **before** deploying code that reads new columns.

## ADR-11 — Push toward player-run / self-service

**Decision:** wherever possible, let captains and players do the work, not just organizers — self-substitutions, self-scoring, captain-run team leagues, player-run round-robin sessions.
**Context:** organizer time is the scarce resource; reducing their load is both a product and a retention strategy. Flex league is the model (fully player-driven).
**Consequences:** new features should ask "can the player/captain do this themselves?" — with the organizer retaining override.
