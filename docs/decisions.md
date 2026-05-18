# Joinzer Decisions Log

A running log of product and architectural decisions. Every time we make a call that affects how the app behaves — refund policy, partner billing model, taxonomy choice — it goes in here, in date order, newest at the top.

**Why this file exists:** Claude Code sessions are short-lived. Without a written log, every session has to re-ask the same questions or guess at past decisions. This file is the persistent memory.

**How to use it:**
- Add a new entry at the top whenever a decision is made.
- Use the format below.
- Reference this file at the start of every Claude Code session.
- When a decision changes, don't delete the old entry — add a new one above it that supersedes the old, and link back.

---

## Format

```
## YYYY-MM-DD — <Topic>
**Status:** Active | Superseded | Reverted
**Affects:** <tickets, surfaces, or systems this decision impacts>
**Decision:** <one sentence, the actual call>
**Reasoning:** <2–4 sentences on why>
**Open questions:** <anything we still don't know, if applicable>
```

---

## 2026-05-18 — Ticket 3A — Events read cutover
**Status:** Complete
**Affects:** `events` read paths — `EventListItem`, `EventDetail` types; `EventCard`, event detail page, events list page, create-from-template page
**Scope:** 5 files, 4 commits — `lib/types.ts`, `components/features/events/EventCard.tsx`, `app/(app)/events/[id]/page.tsx`, `app/(app)/events/page.tsx`, `app/(app)/events/create/page.tsx`. Merged at `cd2ffaf`.
**What changed:** All read paths on `events` now select and reference `skill_min` / `skill_max`. The legacy `min_skill_level` / `max_skill_level` fields remain in the schema and continue to be written by `prepareEventWrite` (Phase 2 dual-write, untouched). `EventListItem` and `EventDetail` types no longer declare the legacy fields.
**Bonus fix:** Corrected a pre-existing render bug affecting 7 production rows where `max_skill_level = NULL` was rendered as "3.0 – undefined" or "3.0 – ". Replaced with four-case skill render logic: both set → "3.0 – 4.0"; min only → "3.0 and up"; max only → "Up to 4.0"; neither → no badge. Applied identically to EventCard (clinic variant), EventCard (game variant), and event detail page.
**Phase 4 dependency:** `events.min_skill_level` and `events.max_skill_level` can be dropped from the schema once all of 3A, 3C, and 3B are deployed and stable for ≥ 7 days.
**Future cleanup noted (not blocking):** The 11-line skill render block is now duplicated in three locations (EventCard clinic, EventCard game, event detail page). Extract to a `formatSkillRange(min, max)` helper in `lib/format.ts` or similar at next opportunity.

---

## 2026-05-18 — 3A.1 — Garbage division cleanup
**Status:** Complete
**Affects:** `tournament_divisions` — Phase 3C prerequisite
**What was deleted:**
- 4 `tournament_divisions` rows with NULL `format`: "single" (46985294), "Open" (d4330f4c), "double" (6c69c827), "Women" (ababe148) — all in published tournament "For Testing", organizer Roderick Mendoza (confirmed tester account)
- 6 `tournament_registrations` rows across the 4 divisions (3 by Marty, 3 by Roderick)
**Final state:** 25 divisions total, 0 with NULL `format`, 0 skill backfill missed. Phase 3C prerequisite met.
**Method:** Deletions executed via Supabase MCP directly — no migration file, no rollback SQL. Acceptable for this scope: data was cruft from now-removed broken UI options (`'singles'` league format, `'Open'` division skill entry) caught and fixed earlier in this session. No real organizer data affected.

---

## 2026-05-18 — Phase 3 read cutover split (3A / 3A.1 / 3C / 3B)
**Status:** Active
**Affects:** `events`, `leagues`, `tournament_divisions` read paths; `CompeteClient` filter logic; `PlayerCheckIn` sub-request write path; all taxonomy-dependent UI components
**Decision:** Phase 3 (flip reads from legacy taxonomy columns to new canonical columns) split into four tickets executed in this order: 3A (events) → 3A.1 (garbage cleanup) → 3C (tournament divisions) → 3B (leagues). Phase 4 (drop legacy columns) is a separate ticket, gated on all three read-cutover tickets being live and stable in production for at least 7 days.
**Ordering rationale:**
- 3A first — events is a numeric-to-numeric shape swap with identical semantics, zero risk, builds confidence.
- 3A.1 second — deletes the 4 null-format division rows (single, Open, double, Women — confirmed test data from now-removed broken UI options). Cheap prerequisite that unblocks 3C.
- 3C third — tournament divisions is the most complex (team_type drives 5 logic branches, category drives player search gender filter), but its prerequisite (3A.1) is the cheapest item on the list. Doing the hard thing while energy is fresh; also fully resolves the naming ambiguity from ticket 4.1.5.
- 3B last — leagues is the only ticket with real user-visible UX redesign (string-enum skill dropdown → numeric range picker). Deserves the most thought and design attention; wrong to rush it.
**Precondition on 3B:** Complete a `league_sub_requests` mini-audit before opening the 3B PR. `PlayerCheckIn.tsx` posts `league.skill_level` as `requested_skill_level` to that table. Phase 3B must understand what reads that column downstream before the source column is dropped. Findings must be documented in `docs/decisions.md` before the PR opens.
**Additional finding from audit:** 18 of 29 `tournament_divisions` rows have NULL `skill_min`/`skill_max`, all matching NULL `skill_level` in the legacy column. The Phase 1 backfill was correct — these divisions genuinely have no skill constraint. Whether that reflects organizer intent ("open to all") vs. organizer omission is a product UX question worth surfacing separately; it does not block Phase 3.
**Audit source:** `docs/investigations/phase3-read-cutover-audit-2026-05-18.md`

---

## 2026-05-18 — Ticket 4.1.5 — format_type → bracket_type rename complete
**Status:** Active
**Affects:** `tournament_divisions.bracket_type` (was `format_type`); `tournament_divisions_bracket_type_check` constraint (was `tournament_divisions_format_type_check`); 8 app files
**What was renamed:**
- Column `tournament_divisions.format_type` → `bracket_type` (stores bracket/schedule algorithm: `round_robin`, `single_elimination`, `double_elimination`, `pool_play_playoffs`)
- CHECK constraint `tournament_divisions_format_type_check` → `tournament_divisions_bracket_type_check` (constraint body auto-updates on `RENAME COLUMN`; name does not — required explicit `RENAME CONSTRAINT`)
**Migration:** `supabase/migrations/20260518000001_rename_format_type_to_bracket_type.sql`, applied 2026-05-18. NOT idempotent — will fail if re-run. Rollback SQL in `docs/investigations/format-type-rename-2026-05-18.md §5`.
**Scope:** 36 edits across 8 app files — `FormatSettingsFields.tsx`, `DivisionsSection.tsx`, `MatchesSection.tsx`, `app/(app)/tournaments/[id]/page.tsx`, `app/(app)/tournaments/[id]/organizer/_components/types.ts`, `app/api/tournaments/[id]/divisions/route.ts`, `app/api/tournaments/[id]/generate-all/route.ts`, `app/api/tournaments/[id]/divisions/[divisionId]/generate-matches/route.ts`. Single migration file. Merged at `2e56ab8`.
**Verification:** Schema rename confirmed via live DB query — column exists as `bracket_type`, constraint as `tournament_divisions_bracket_type_check`, 28 rows preserved across all 4 bracket types. Vercel deploy green at `2e56ab8`. Manual surface check on joinzer.com confirmed divisions render and add-division form opens correctly.
**Backup:** `C:\Users\marty\joinzer-backups\pre-4.1.5-20260518-1234.json` (28 rows, all columns, JSON export via Supabase MCP — pg_dump unavailable on dev machine).
**Production downtime:** ~5 minutes between STEP 3 (migration apply) and Vercel deploy of `2e56ab8`.
**Follow-up tickets logged:** "Install pg_dump on dev machine" and "Add vitest.config.ts to restrict include to lib/**/*.test.ts" — both added to `docs/joinzer-build-sequence.md` Repo hygiene section.
**Audit:** [docs/investigations/format-type-rename-2026-05-18.md](investigations/format-type-rename-2026-05-18.md)
**What's next:** Ticket 4.2 (Taxonomy Phase 3 — drop old columns). Do not start without explicit go.

---

## 2026-05-18 — Division SKILL_OPTIONS 'Open' removed
Removed `'Open'` from `SKILL_OPTIONS` in `DivisionsSection.tsx`. Violated the 2026-05-13 decision to reserve "Open" exclusively for gender/format semantics. Also produced a partial DB row if selected — `skill_level='Open'` but `skill_min=null, skill_max=null` because `'Open'` has no entry in `DIVISION_SKILL_TO_RANGE`.

---

## 2026-05-18 — Phase 2 dual-write — Ticket 4.1
**Status:** Active
**Affects:** `leagues`, `tournament_divisions`, `events` write paths; `lib/taxonomy/write-helpers.ts` (new); tickets 4.1.5 and 4.2 downstream
**Decision:** New columns (`format`, `skill_min`, `skill_max`) are now written on every relevant create/update. Legacy columns (`skill_level`, `category`, `team_type`, `min_skill_level`, `max_skill_level`) continue to be written unchanged. No reads changed. No schema changes. No DB triggers.
**Architecture:**
- Three pure TypeScript helpers at `lib/taxonomy/write-helpers.ts`: `prepareLeagueWrite`, `prepareDivisionWrite`, `prepareEventWrite`
- Lookup tables named `LEAGUE_SKILL_TO_RANGE` (lowercase keys) and `DIVISION_SKILL_TO_RANGE` (Title Case keys) — casing difference is pre-existing and intentional to match DB values; dies naturally in Phase 3 read cutover
- 15 unit tests at `lib/taxonomy/__tests__/write-helpers.test.ts` covering all 8 Phase 1 division mapping pairs, all skill level entries, fallbacks, null handling, and legacy pass-through
**Write sites wired (4 of 4 in scope):**
- Site 1: `app/(app)/compete/leagues/create/CreateLeagueForm.tsx` — leagues INSERT
- Site 2: `app/(app)/compete/leagues/[id]/edit/page.tsx` — leagues UPDATE
- Site 3: `components/features/tournaments/DivisionsSection.tsx` — tournament_divisions INSERT
- Site 5: `components/features/events/CreateEventForm.tsx` — events INSERT
**Deliberately out of scope:**
- Site 4 (`DivisionsSection.tsx` division format-editor UPDATE) — writes only `format_type` + `format_settings_json`, no taxonomy columns
- `EditEventForm` — skill is immutable post-creation by design (Ticket 3.7 covers future editability)
- `tournament_events` table — confirmed dead code path, no active UI routes to it
**Smoke steps:** 4 manual browser verification steps documented. Run after deploy. See audit: [docs/investigations/phase2-dual-write-audit-2026-05-18.md](investigations/phase2-dual-write-audit-2026-05-18.md)
**Site 2 note:** League edit skill/format fields are `disabled` when `registrantCount > 0` — intentional product guard to protect existing registrations. The `disabled` HTML attribute does not block dual-write; `prepareLeagueWrite` still fires on submit with the unchanged `skill_level` value from state.
**Smoke verification (2026-05-18):** Sites 1, 3, 5 verified via live DB inspection of `phase2-verify-postdeploy` and `SMOKE-EVENT-SITE5` test rows. Site 2 verified via source inspection — single update path confirmed, helper on `edit/page.tsx:158`, full investigation report from this session.
**What's next:** Ticket 4.1.5 (rename `format_type` → `bracket_type`) then Ticket 4.2 (Phase 3 column drop). Do not start either without explicit go.

---

## 2026-05-18 — League format 'singles' removed
Removed broken `'singles'` league format option (constraint violation since Phase 1). Replaced with `open_singles` labeled "Singles" in the UI. Future singles variants (men's/women's) can be added when demand exists.

---

## 2026-05-18 — Roster panel scope — Ticket 2.1
**Status:** Active
**Affects:** `/compete/leagues/[id]` — `LeagueRosterPanel.tsx` (new component), `page.tsx` (query + mount)
**Decision:** Read-only roster panel shipped. Scoped to display only — no Add Player, Remove, or Import CSV in this ticket.
**What shipped:**
- `LeagueRosterPanel` client component: registered player list, doubles-adaptive (pairs via `partner_user_id`), singles flat list
- RatingBadge per player (reuses existing component — `dupr_rating` / `estimated_rating` / `rating_source`)
- Crown + "Organizer" badge for `created_by` user (no separate captain role in leagues schema)
- "✓ can sub" badge from `league_sub_interest` table (league-scoped, not global)
- Sub-available filter chip (Registered / Sub available toggle)
- Empty state with copy-invite link
- Capacity line: `X/max players · N spots open` or `Full · N on waitlist`
**What was deferred:**
- Skill-range filter: no per-user `skill_min`/`skill_max` on `profiles` — deferred until that column exists
- Add Player / Remove / Import CSV: out of scope for 2.1; belongs in a later organizer-action ticket
**Flag resolutions:**
- Flag A (skill badge): `RatingBadge` as-is — no per-user skill range data source exists
- Flag B (captain): `created_by` treated as Organizer with Crown icon — no separate captain concept in leagues
- Flag C (sub flag): `league_sub_interest` only — league-scoped signal, correct source of truth
**Constraint:** Tailwind-only styling enforced (project rule — no shadcn/ui, no Radix). `'use client'` boundary on panel only; page remains Server Component.

---

## 2026-05-18 — format_type vs format on tournament_divisions
**Status:** Active
**Affects:** `tournament_divisions`; Phase 2 dual-write plan; Phase 3 column drop plan
**Question:** Are `format_type` and the new `format` column redundant, conflicting, or independent?
**Investigation:** Read-only session 2026-05-18. Full report: [docs/investigations/format-type-vs-format-2026-05-18.md](investigations/format-type-vs-format-2026-05-18.md)
**Answer:** Fully independent axes. Zero value-level overlap.
- `format_type` = bracket/schedule algorithm (`round_robin`, `single_elimination`, `double_elimination`, `pool_play_playoffs`). Drives match generation API and bracket vs. standings UI. `NOT NULL DEFAULT 'round_robin'`, well-constrained, actively used across 6 files / 15 read-write sites.
- `format` = gender/team composition (`mens_doubles`, `mixed_doubles`, `individual_round_robin`, etc.). Drives who plays. Added in Phase 1. Nullable until dual-write lands.
**Decision:** Rename `format_type` → `bracket_type` in a dedicated ticket scheduled between Phase 2 and Phase 3. The name `format_type` is ambiguous next to `format`; `bracket_type` is self-documenting. Do not touch in Phase 2 — Phase 2 is strictly about writing the new `format` column, not renaming anything.
**Rename scope:** One migration (`RENAME COLUMN`), one PR touching 6 files. Run `generate_typescript_types` post-migration — TypeScript compiler will catch any missed references. See ticket 4.1.5 in build sequence.
**Open follow-up:** In practice, does `format = individual_round_robin` always pair with `bracket_type = round_robin`? If these two values are always coupled in real data, normalization could eventually collapse them. Not a blocker — revisit after Phase 3 drop when the data picture is clean.

---

## 2026-05-18 — Taxonomy Phase 1 applied
**Status:** Active
**Affects:** `tournament_divisions`, `leagues`, `events`
**Decision:** Migration `20260514000001_taxonomy_phase1.sql` applied to production on 2026-05-18. All three post-migration verification queries passed.
**Results:**
- `tournament_divisions`: `format`, `skill_min`, `skill_max` columns added and backfilled (23 rows). Zero divisions missing a format. One non-dummy coerced row: "zzz" free event → `mens_singles` (expected; review with organizer before Phase 3 drops old columns).
- `leagues`: `leagues_format_check` constraint replaced with full 10-value enum. `skill_min`, `skill_max` added and backfilled (7 rows, all `intermediate` → 3.0/3.5).
- `events`: `skill_min`, `skill_max` added and copied from `min_skill_level`/`max_skill_level` (18 rows).
- One line change from reviewed version: `category='singles' AND team_type='singles'` maps to `mens_singles` (not `open_singles`). Approved by Marty before apply.
**Recovery:** Pre-migration dump at `C:\Users\marty\joinzer-backups\pre-1.1-20260518-1045.sql`. Supabase scheduled backup at apply time: 18 May 2026 09:27:21 UTC.
**What's unblocked:** Tickets 1.2, 1.3, 1.6, and downstream Batch 4 reads switch. Phase 2 (dual-write on create/update paths) is next — wait for explicit go.
**Open question (carry forward):** `tournament_divisions.format_type` (`round_robin`, `single_elimination`) and the new `format` column (`mens_doubles` etc.) are different columns with different semantics — no conflict. Before Phase 2 read cutover, decide: rename, merge, or keep separate?

---

## 2026-05-15 — Taxonomy Phase 1 staged and verified, pending apply
**Status:** Superseded by 2026-05-18 entry above

---

## 2026-05-15 — Organizer name visibility on league surfaces
**Status:** Active
**Affects:** `/compete` league list, `/compete/leagues/[id]` detail page; any future league-adjacent surfaces
**Decision:** Organizer display names are public on league list and detail pages. No opt-out for organizers at pilot scale.
**Reasoning:** Knowing who runs a league is a primary trust signal for a player deciding whether to register. Displaying the organizer name is consistent with tournament surfaces (already done) and necessary for basic accountability. At pilot scale with known organizers this is acceptable. When the platform grows beyond known/consenting organizers, revisit: add a profile privacy toggle covering "show my name on public league pages."
**Open questions:** `profiles.display_name` exists in the schema but is NULLABLE and unused — every surface uses `profiles.name` instead. Audit whether `display_name` was ever populated; if not, drop or repurpose the column in a future schema cleanup.

---

## 2026-05-14 — Database backup strategy
**Status:** Active
**Affects:** Ticket 1.1 (taxonomy Phase 1); all of Batch 1; all future schema migrations
**Decision:** Do not apply schema migrations to production without a verified restore point. Supabase Free plan does not include automated backups or point-in-time recovery. Upgrade to Supabase Pro before 1.1 ships. Not done yet — gating on cost/timing.
**Reasoning:** Ticket 1.1 is an additive migration with a one-shot backfill touching real user data. If the backfill produces wrong results, the only recovery path is a restore. Running it without a restore point is not an acceptable risk. The migration SQL is fully reviewed and approved — it is ready to run the moment a backup exists.
**Implications until resolved:**
- Ticket 1.1 (taxonomy Phase 1) is blocked.
- All of Batch 1 is blocked downstream of 1.1.
- All of Batch 4 (Phase 2 taxonomy read switch) is blocked.
- Any other schema migration is similarly blocked.
- Non-schema work (UI, application logic, new features) is unblocked.
**Action items when upgrading:**
- Verify daily scheduled backups are active.
- Take a manual on-demand backup immediately before applying 1.1.
- Paste the backup timestamp to Claude Code to unblock the migration.

---

## 2026-05-15 — Backup strategy clarification (pilot stage)
**Status:** Active
**Affects:** All schema migrations at pilot scale; supersedes the implied PITR requirement in 2026-05-14
**Decision:** "Verified restore point" at pilot scale means Supabase Pro daily backups confirmed running AND a fresh pre-migration pg_dump of affected tables to a local file within 24 hours of the migration. PITR is not required at this stage.
**Reasoning:** The 2026-05-14 decision required a "verified restore point" but never explicitly required PITR. After investigating actual Supabase costs (PITR is a $100/mo add-on requiring a compute upgrade), the practical interpretation for pilot stage is clarified here. At pilot scale (under 100 rows per table, under 50 test users), a daily backup + fresh local pg_dump provides sufficient recovery coverage. PITR becomes relevant when actual customer revenue or PII is at risk.

**At pilot scale (current):** "Verified restore point" means BOTH of:
1. Supabase Pro tier active with daily automated backups confirmed running (visible in Database → Backups → Scheduled Backups)
2. A fresh pre-migration pg_dump or table export of the affected tables to a local file, performed within 24 hours of the migration

**At production scale (when actual customer revenue or PII is at risk):** Re-evaluate PITR. The $100/mo cost becomes rounding error against the value of second-precision recovery once real customers are paying for events.

The trigger to re-evaluate is "first real paid customer beyond Marty's test accounts." File a ticket then, not before.

---

## 2026-05-13 — Import "No account" rows
**Status:** Active
**Affects:** Tickets 0.4, 1.5
**Decision:** When a CSV import preview contains rows with no matching Joinzer account, render a checkbox at commit time: "Send signup invites to N emails without accounts." Default unchecked. If checked, the importer creates stub user rows and sends magic-link invite emails. If unchecked, those rows are skipped entirely and surfaced in the preview as a final summary ("3 emails will be skipped").
**Reasoning:** Real org workflows are split — some org leaders are inviting their whole existing roster (want invites sent), others are working from a contact list with strangers (want strangers skipped). One checkbox covers both without forcing a project-level decision.

## 2026-05-13 — Test data on public lists
**Status:** Active
**Affects:** Ticket 0.2; all public list queries (`/compete`, `/tournaments`, `/events`, `/players`)
**Decision:** Add an `is_test boolean NOT NULL DEFAULT false` column to leagues, tournaments, and any other entity where test data has been leaking. Backfill existing keysmash/test rows as `is_test = true`. All public list queries filter `is_test = false`. A `?showTest=1` query param re-includes test rows for authenticated admin/owner accounts only — never for anonymous visitors.
**Reasoning:** Deleting test data wipes Marty's own dev surface. Tagging keeps the data around for local testing while keeping it off prospect-facing screens. The query-param escape hatch lets Marty see everything when needed.

---

## 2026-05-13 — Mixed Doubles gender enforcement
**Status:** Active
**Affects:** Taxonomy migration; all doubles registration flows
**Decision:** `mixed_doubles` format is advisory only. The system displays "1 male + 1 female per team" as a helper string, but the registration flow does not enforce it. Any gender combination can register for a mixed doubles event.
**Reasoning:** Most recreational pickleball leagues don't enforce strict 1M/1F. Sanctioned/competitive events will need enforcement later, but adding it now slows the MVP and creates registration friction. Easy to add a check at the registration RPC layer later if needed.

---

## 2026-05-13 — Login flow
**Status:** Active
**Affects:** Ticket 5.3; authentication
**Decision:** Migrate from email+password to Google OAuth + magic link. Remove the password field from the login form. Existing password accounts can log in via magic link to the same email on next visit.
**Reasoning:** Recreational pickleball app doesn't justify password friction. Magic link + Google is faster, more secure (no reused passwords), and reduces "forgot password" support volume to zero.

---

## 2026-05-13 — Format taxonomy
**Status:** Active
**Affects:** Taxonomy migration plan; tournament divisions, leagues, sessions
**Decision:** Adopt one canonical `format` enum with 10 values: `mens_singles`, `womens_singles`, `open_singles`, `mens_doubles`, `womens_doubles`, `mixed_doubles`, `coed_doubles`, `open_doubles`, `individual_round_robin`, `custom`. Replace the broken Category × Team Type pair on tournament divisions with this single enum. League `format` updates to the same list.
**Reasoning:** Current Category × Team Type creates ambiguous combinations (Singles in both lists). One enum eliminates the ambiguity, matches how pickleball players actually describe events, and simplifies match-generation branching.

---

## 2026-05-13 — Skill taxonomy
**Status:** Active
**Affects:** Taxonomy migration plan; profile, divisions, leagues, sessions, filters
**Decision:** Store skill as numeric range (`skill_min`, `skill_max` for events; `self_rating` for users, both `numeric(3,1)` in 0.5 steps from 2.0 to 8.0). Display via named tier presets (Beginner, Intermediate, etc.) derived from the numbers. Use "All levels" for the no-skill-filter case. Reserve the word "Open" exclusively for gender-composition formats (`open_doubles`, `open_singles`).
**Reasoning:** Numbers compose for filtering and comparison; named tiers are display-only. Separating "All levels" (no filter) from "Open" (gender composition) eliminates the dual-meaning of the word "Open" that caused confusion in the original review.

---

## Open decisions (still need a call)

These block specific tickets. Resolve before starting the relevant ticket.

### League partner billing
**Blocks:** Ticket 2.4
**Options:**
- **A:** Captain pays for both (team fee = 2× per-person price).
- **B:** Each partner pays separately; captain pays first, partner pays on invite acceptance.
- **C:** Org chooses per-league at creation time.
**Recommendation:** B for MVP — matches typical rec league behavior, no "you owe me $10" awkwardness.

### Refund policy
**Blocks:** Ticket 3.4
**Options:**
- **A:** 100% auto-refund until registration deadline, 0% after.
- **B:** Manual case-by-case, org decides.
- **C:** Tiered (100% / 50% / 0% by days-out).
**Recommendation:** A — simplest, automatable via Stripe Refunds API, no chargeback exposure.

### Solo auto-matcher
**Blocks:** Ticket 3.5
**Options:**
- **A:** Ship the real matcher — daily FIFO pairing, email both players.
- **B:** Change the copy to honest manual fallback ("The organizer will pair solo players before the deadline").
**Recommendation:** B first (1-hour copy change), A when solo volume justifies the build.
