# Joinzer — Decision Log (ADRs)

_Last updated: July 31, 2026_

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

## ADR-12 — Address provenance under Google Places ToS

**Decision:** every `facility_listings.address` carries an `address_source` drawn from a pinned six-value vocabulary (`official_page | osm | county_open_data | manual_research | organizer | unknown_legacy`). A Places `formatted_address` is **not** a storable source — addresses traceable only to Places are **nulled and stamped `unknown_legacy`**. Every future address write must set the column.
**Context:** GMP Places ToS §3.2.3(a)-(b) permits storing `place_id` but not caching most other Places data; a formatted address is not ours to keep. The column had also been created in the dashboard out-of-band — the same drift class as `lat`/`lng`/`sort_order` — so a rebuild-from-migrations wouldn't have reproduced it.
**Consequences:** address provenance is auditable and ToS-defensible. The CHECK constraint pins the vocabulary so a seventh value is a deliberate schema change rather than a silent write. (`supabase/migrations/20260724000007_formalize_address_source.sql`; companion column `address_verified_at`.)

## ADR-13 — Venue schema: `facility_listings` canonical, `locations` operational

**Decision:** `facility_listings` is the **canonical venue record**; `locations` remains the **operational** table and links to it through a nullable `facility_listing_id` bridge. The legacy overloaded `locations.access_type` is **frozen** — new venue writes use the unified vocabulary on the canonical record (`access_type` in `public/private/membership/school/hoa/unknown`, plus `fee_type` and `indoor`). `locations.category`, `source_url`, `notes` and `phone` are **deprecated, marked, not dropped**.
**Context:** the legacy `access_type` conflated access, fee, indoor and category into one enum (`resort`, `fee_based`, `business`, `indoor_public`, `semi_private`…), which cannot support a queryable public directory. The directory needs clean SEO-facing fields without breaking the live operational path.
**Consequences:** strictly additive and non-destructive — no drops, no deletes, no lossy rewrites of `locations` rows. **Phase 3A (schema) is done; Phase 3B (read-path and write-path cutover) is still pending** — the deprecated columns are still read today. Migrations applied to Supabase before dependent code, per ADR-10. (`supabase/migrations/20260724000001` through `…000005`.)

## ADR-16 — A low-precision coordinate publishes, behind an approximate-location label

> **DRAFT — AWAITING OWNER SIGN-OFF ON THIS TEXT.** The decision is the owner's, taken 2026-08-04;
> what needs approval before merge is the wording below. Filed as a NEW ADR rather than an amendment
> to the 2026-07-28 ruling because it reverses a publishing philosophy rather than adjusting a
> threshold — the old rule is preserved intact under Context, which an in-place edit would destroy.

**Decision:** **reverses the coordinate-precision clause of the 2026-07-28 publish gate.** A listing
whose geocoded coordinate is classified `low` — a street centerline, or a large-polygon centroid
standing in for the courts — now **publishes**, and its venue page and every list row that renders it
carry a plain-text approximate-location note. The rest of the gate is untouched: coordinate
**present**, slug, `access_type != 'unknown'`, candidate `research_status='verified'`. **A row with no
coordinate at all is still held**, and that distinction is the load-bearing part of this ruling — a
label can qualify a pin, it cannot invent one.

**Context:** 348 held drafts had accumulated across 39 imported metros. Of those, 186 were blocked
only on the coordinate, and **91 across 32 metros passed every other gate condition and were held
solely because their pin was a street rather than a building.** Those are researched, source-verified,
real venues — Portland 9, Ogden 7, Killeen-Temple 6, Lexington 6, Port St. Lucie 6, Salt Lake City 6,
Durham 5, Jackson 4, and 24 further metros at 3 or fewer. The builder's recommendation was to keep
holding them, arguing that a labelled pin on the wrong end of a 2.2 km road still sends a player to
the wrong place (Baton Rouge's Burbank Drive is the worked example). The owner weighed that against a
directory that silently omits a third of the venues it has already researched, and ruled the other
way: a venue the reader can find, with an honest caveat about the pin, beats one they never learn
exists.

**Consequences:** the label is **not optional and not deferrable** — the gate change and the
user-visible affordance ship in the same commit, because a published low-precision pin presented as if
it were exact is the harmful version of this change and the only version worth blocking over.
Enforcement moved to `scripts/lib/publish-gate.mjs`, shared by `import-metro-merged.mjs` and
`publish-facilities.mjs`: the two carried private copies of the old rule, and relaxing one alone would
have let the reconciling pass silently un-publish every row the importer promoted, one metro at a
time. The render layer reads a new generated column `facility_listings.location_precision` (migration
`20260804000001`) rather than `provenance`, which stays off the client under ADR-14. Two consequences
accepted rather than solved: **the internal-proximity duplicate guard deliberately skips low-precision
pairs** (two venues on one street band are indistinguishable to it), so two approximate rows may
publish as near-identical pins — previously invisible because neither published; and a row anchored on
a **co-tenant at the correct street number** (a mall, a neighbouring business) is classified `low` and
will now publish wearing an "approximate" label that is arguably too pessimistic, since that
coordinate is in fact rooftop-accurate. The second is what a future co-tenant-precision ruling fixes.

## ADR-15 — Cron health is verified by hand, not monitored

**Decision:** cron health is checked by a human in the Vercel dashboard's Cron Jobs tab, and one invariant makes that reliable: **any change to `CRON_SECRET`, and any newly added cron, must be followed by verifying that at least one cron run returns 200.** No heartbeat table, no third-party uptime watcher, for now. `lib/cron/auth.ts` `assertCronSecret` logs the two failure modes distinctly (`MISCONFIGURED` = the secret is absent in this environment; `UNAUTHORIZED` = the caller sent the wrong token) so a future occurrence is greppable in the runtime logs.

**Context:** `CRON_SECRET` was never set in Vercel. Every scheduled cron returned 401 from the day it was introduced — `session-reminders` since May 7 2026, the other four since mid-July — and nothing surfaced it for roughly three months. The failure was invisible precisely because it was *clean*: a 401 with a well-formed JSON body is indistinguishable from a healthy no-op unless someone reads the status code. Vercel's own dashboard did record it; nobody had reason to look.

**Consequences:** accepted honestly — **no code change inside Joinzer can make silence loud.** A cron that never runs writes no log, and a job that would alert about broken crons is itself a cron sharing the same failure cause. Only an external check (a dead-man's-switch pinged by each run) or a scheduled digest whose *absence* is the signal can close that gap, and both were deferred as premature at zero real users. Revisit when players actually depend on reminders or forfeits landing on time; the natural upgrade is an external watcher reading a heartbeat row, at which point the heartbeat table earns its migration. Until then the manual invariant above is the whole mechanism, and it is written down here because it is the thing that would have caught this in May.

## ADR-14 — Aggregator directories: tier-4 research input, never bulk ingest, never user-facing

**Decision:** **reverses the prior blanket prohibition.** Aggregator directories (Pickleheads, Places2Play, etc.) are permitted as a discovery-stage lead source and as **evidence at tier 4 of 5** — below official venue/operator, municipal/county, and association sources; above general third-party directories. Three hard limits: **never a bulk-ingest or bulk-scrape source** (per-record lookups only, the same posture as Google Places); **never displayed or republished** on Joinzer pages; and **a venue cannot reach `research_status='verified'` on aggregator evidence alone** — that requires a controlling-entity source (the city that owns the courts, the operator that runs the facility, or the association that runs play there). Aggregator-only venues rest at `probable`. Aggregator-sourced values are populated at medium confidence with the source tier recorded.
**Context:** the Reno–Sparks pilot ran two independent nine-stage builds side by side. The run that used aggregators reached HOA and active-adult venues that Google Places systematically cannot surface under any query — the single venue class the directory is weakest on. The blanket ban was costing real coverage there. It stays at tier 4 because the evidence cuts both ways: in the five-venue Lake Havasu pilot, aggregators contradicted higher-tier sources twice and were **wrong both times** (lighting at Dick Samp, fee at The Ark Center), and separately invented a venue that does not exist ("London Bridge Racquet & Fitness Club").
**Consequences:** bulk scraping stays absolutely barred — a competitor's compiled listing database is a distinct legal-risk surface from a per-record lookup, and Joinzer must never appear to republish one. `provisional` is **not** a valid status: `facility_candidates.research_status` is pinned by CHECK to ten values, and `probable` is the one meaning "believed real, not confirmed" (`20260724000006`). `address_source` (ADR-12) has no aggregator value — aggregator-sourced addresses file as `manual_research`. Supersedes the aggregator clauses in `CLAUDE_CODE_JOINZER_DIRECTORY_BRIEF.md` §2.4 and §6.
