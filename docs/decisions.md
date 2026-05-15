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
