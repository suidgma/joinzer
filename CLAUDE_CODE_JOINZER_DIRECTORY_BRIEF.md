# Build Brief — Joinzer Public Court Directory

> **For Claude Code.** Read this entire file first. Follow the phases in order.
> **Do not write or modify any code until the GO-GATE in Phase 2 and I approve your plan.**
>
> This **supersedes** the earlier "Directory Master" website and pipeline briefs — those
> targeted a different, throwaway codebase. The directory is now a surface of **Joinzer itself**.

---

## 0. Context

Joinzer is my pickleball platform (Next.js 14 App Router, TypeScript strict, Tailwind,
Supabase: Postgres + Auth + RLS + Realtime). It has four surfaces (Coordination, Leagues,
Tournaments, Players) and is **entirely auth-gated today** — which is a top-of-funnel and
network-effect problem.

This work adds a **public, SEO-indexable pickleball court directory** as a new Joinzer
surface. Goal: rank for "pickleball courts in [city]" and similar, give un-gated public browse
pages, and funnel visitors into signup for the gated app. It is built **into the Joinzer
codebase and Supabase**, not a separate app.

The target data model is a 94-field pickleball-facility schema (see the field-schema doc):
Layer 1 core location/contact, L2 import/publish control, L3 domain (court counts, surface,
access, schedules…), L4 AI enrichment (44 fields: HTML body, speakable, quickfacts, type-
branched Q&A), L5 Google Places (place_id, rating, reviews), L6 freshness/tracking, L7
monetization (ship empty). Most of these don't exist in any data yet and must be generated.

I already have ~204 raw Arizona facilities from OpenStreetMap (name, lat/lng, court_count,
access) staged as seed data; **Phoenix is the proof city**, then the rest of Arizona.

### Working assumptions — validate in Phase 1, confirm/override at the GO-GATE

- **Data home:** a **separate, public-readable listing table** (e.g. `facility_listings`) for
  directory facilities + their enrichment, **keyed so it can later link to the operational
  `locations` table** (e.g. a nullable `location_id`). Do **not** bolt the 94 marketing/SEO
  fields onto the live `locations` table — keep operational venue data and public directory
  data separate but linkable.
- **Facility ↔ venue:** directory facilities are their own records for now; linking them to
  operational Joinzer venues (so a listing can show real sessions/leagues there) is a **later**
  growth-loop step, not part of this build.
- **Geography:** start with Phoenix/Arizona seed data. Existing operational courts are Las
  Vegas — do **not** merge or migrate those here; reconcile later if ever.
- **Public vs gated:** directory routes are **public, server-rendered, indexable**, and must
  render with **no authenticated session** — outside the auth-gated app shell.
- **LLM generator:** reuse the same LLM approach we use elsewhere; route every LLM call
  through one wrapper so the model is a one-file swap.

---

## 1. Phase 1 — Investigation (READ ONLY, no changes)

Verify against the real codebase and DB — do not trust docs over code. Report back before proposing anything.

1. **Locations / venue schema:** find the operational `locations` (courts) table, its columns,
   and everywhere it's used (play sessions, leagues, tournaments). Confirm whether a separate
   public listing table is the right call vs. extending it. Report the schema.
2. **Auth & routing:** how is the app auth-gated (middleware, layout, route groups)? Where
   would a **public, unauthenticated, SSR** route group live so it bypasses the gated shell?
   Find any existing public routes.
3. **Supabase / RLS:** how are tables, policies, and migrations managed in this repo? What's
   the pattern for a **public-read** policy (so only `published` facilities are world-readable)
   and for server-only writes (service role never in the client)?
4. **Marketing/site structure:** there's a planned marketing restructure (thin role-router at
   `/`, organizer + player landing pages). Determine how the directory should coordinate with
   it — is `/courts` a sibling public surface? Report what exists and flag collisions (note the
   known `/players` public-vs-authenticated route-collision precedent).
5. **Existing LLM + external API usage:** how are LLM calls and any external APIs configured
   and keyed today? What env-var conventions are used? We'll also need a Google Places key.
6. **Secrets:** confirm `.env*` is gitignored and the Supabase service role key is server-only.
   **If any secret is hardcoded in source, STOP and flag it.**
7. **The in-flight refactor:** the two-form-factor refactor (slices 4/5/6 + chrome-fix) is
   active. Identify those surfaces so this work does **not** collide with them.

Output a written summary, then propose a plan (Phase 2).

---

## 2. Phase 2 — Plan & GO-GATE 🚦

Write a short plan: the data-model decision (with your recommendation), the public-route
strategy, files to create/modify (one line each), the field-key contract, migration plan,
external cost/risk notes, and open questions. **Then STOP and wait for my explicit approval
before writing any code.** Revise and wait again if I ask for changes.

---

## 3. Scope (after approval) — three separable builds

Each is its own focused CC session. Build in order; don't start the next without the previous validated.

### 3A. Data model + RLS
- Create the public listing table(s) per the approved decision. Use **real columns** for
  queryable/SEO fields (name, listing_type, city, state, lat/lng, court_count, access_type,
  `published`, `slug`, `location_id` nullable) and a **JSONB column** for the enrichment blob
  (listing_content, speakable, quickfacts, the 40 Q&A, Google Places reviews, monetization).
- RLS: public can read **only** `published = true` rows; all writes server-side only.
- Migration committed in the repo's normal migration pattern. No changes to operational tables.

### 3B. Enrichment pipeline (writes to Supabase, server-side)
Staged, idempotent, Phoenix-first:
- **Stage A (deterministic, no LLM):** geocode/reverse-geocode address parts + county/zip;
  Google Places match → place_id, rating, review count, phone, website, one photo URL for the
  image; set L6 tracking; leave L7 empty. Apply the schema's "if missing" rules.
- **Stage B (LLM, behind one wrapper):** generate L3 selects where source data is absent;
  `listing_content` (200–400 words, `<p>`-only HTML, includes a trust signal); 3 speakable +
  4 quickfact blocks; **40 Q&A branched on `listing_type`** (Q1–10 universal; Q11–20 differ for
  Indoor / Outdoor / Private Club / Public Park).
- **Validation + publish gate:** `<p>`-only HTML, allowed select values, correct Q&A set for
  the type, word counts in range; required L1 fields present **and** image non-empty →
  `published = true`, else write the row `published = false` and log why. Never silently publish
  a failed row.
- **Runner:** dry-run-to-JSON default (no DB write), `--limit 1` / single-facility flag,
  idempotent upsert keyed on source id, batching + rate limiting on Google Places and the LLM,
  per-facility logging. Default to **Phoenix only**; explicit flag to run the rest of Arizona.

### 3C. Public directory UI (SSR, indexable)
- Public route group (e.g. `/courts`) rendered **without auth**, server-side, with proper
  metadata. Browse/search/filter page: facility cards (name, type, city, court_count, rating),
  text search, filter by listing_type / access / indoor-outdoor, sort by court_count and name,
  empty state.
- Facility detail page (by `slug`): full content, court/surface/access details, hours, image,
  keyless OpenStreetMap embed when lat/lng exist, Google rating + reviews (per the terms note
  in §6), and an **FAQ accordion + schema.org `FAQPage`/`speakable` JSON-LD** from the Q&A and
  speakable fields (this is the SEO payoff).
- A clear **signup CTA** funneling directory visitors into the gated Joinzer app.
- Tailwind only, reusing existing Joinzer components/design where they fit.

---

## 4. Out of scope (do not touch)

- The auth system, sessions, or any change to who can access the gated app.
- Operational surfaces and logic: play sessions, leagues, tournaments, the operational
  `locations` table, and **all surfaces in the active two-form-factor refactor (slices 4/5/6 +
  chrome-fix)**. Do not refactor or "tidy" these.
- The marketing-site restructure itself (coordinate with it; don't execute it here).
- Linking facilities to operational venues / showing live activity on listings (later phase).
- Monetization wiring (L7 ships empty).
- **Never** commit `.env*`, secrets, the Supabase service role key, or seed dumps.

---

## 5. Engineering rules

- Read existing Joinzer code before editing; match its patterns (route groups, Supabase
  client usage, component conventions). Reuse, don't reinvent.
- Small, focused changes; show diffs as you go. No sweeping rewrites.
- Don't delete code you think is unused without grepping for references **and** confirming with me.
- Code style: ES modules, `async/await`, 2-space indent, descriptive names, comment *why* not
  *what*, modular files.
- **Supabase/RLS:** public-read only on `published` rows; service role key server-side only;
  never expose secrets to the client.
- **Secrets:** env vars only; confirm `.env*` gitignored; stop and warn on any exposed secret.
- Run typecheck/build (and lint if configured) before declaring done; never declare done on a
  red build.
- Stay clear of the in-flight refactor surfaces; if your change would touch one, stop and ask.
- If a request seems wrong or there's a better approach, say so before proceeding.

---

## 6. Cost & terms — surface these, don't barrel ahead

- **Google Places costs per call**, 200+ facilities and growing — recommend the minimal call
  pattern and make persistence of expensive fields configurable.
- **Review caching:** storing Google review text/author long-term may conflict with Google's
  terms. Make persisting review fields a config flag, default conservative, and flag the risk —
  don't assume it's fine.
- **LLM volume:** 44 generated fields × hundreds of rows is real spend. Default to **Phoenix
  only**; require an explicit flag for the rest of Arizona.

---

## 7. Manual test plan

1. **Build/typecheck passes.**
2. **Pipeline single-facility dry-run** (`--limit 1`, no DB write): JSON has all layers;
   `listing_content` is valid `<p>`-only HTML in range; selects within allowed values; Q&A set
   matches the facility's `listing_type`; tracking set; monetization empty.
3. **Publish gate:** a facility with no image is written `published = false` with a logged
   reason, not published.
4. **Phoenix run to DB:** rows upsert into the listing table with the enrichment JSONB
   populated; re-running Phoenix updates in place (idempotent, no duplicates).
5. **RLS:** an unauthenticated/public client can read **only** `published` rows and cannot read
   drafts or write anything.
6. **Public UI while logged out:** `/courts` browse + a detail page render correctly with **no
   session**, search/filters/sort work, empty state appears, OSM map shows when coords exist.
7. **SEO:** page metadata is set and the detail page emits valid `FAQPage`/`speakable` JSON-LD.
8. **No regressions:** the gated app, existing surfaces, and the refactor-in-progress areas
   still load (non-destructive check).

Report what you tested and the outcome.

---

## 8. First action

Begin with **Phase 1 only.** Investigate the real Joinzer codebase and DB, summarize, and
propose a plan — including your data-model recommendation. Then stop at the GO-GATE and wait
for approval. The plan should prove the whole thing on **Phoenix** and hand-validate field
quality before scaling to the rest of **Arizona**.
