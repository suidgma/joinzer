# Phase 2 Dual-Write Audit

**Date:** 2026-05-18
**Type:** Read-only investigation — no code changes, no migrations, no commits
**Scope:** Every write site for `leagues`, `tournament_divisions`, `events`; legacy taxonomy TypeScript; user input shapes; Phase 1 format mapping
**Architecture decision (already made):** New columns canonical; legacy derived at write time via app-side TypeScript helpers; no DB triggers.

---

## 1. Write Site Inventory

| # | File | Line | Table | Operation | Taxonomy columns written today | What triggers it |
|---|---|---|---|---|---|---|
| 1 | `app/(app)/compete/leagues/create/CreateLeagueForm.tsx` | 116 | `leagues` | INSERT | `format` (canonical ✓), `skill_level` (legacy) | League create form |
| 2 | `app/(app)/compete/leagues/[id]/edit/page.tsx` | 153 | `leagues` | UPDATE | `format` (canonical ✓), `skill_level` (legacy) | League edit form |
| 3 | `components/features/tournaments/DivisionsSection.tsx` | 170 | `tournament_divisions` | INSERT | `category` (legacy), `skill_level` (legacy), `team_type` (legacy) | "+ Add Division" in tournament org view |
| 4 | `components/features/tournaments/DivisionsSection.tsx` | 219 | `tournament_divisions` | UPDATE | `format_type`, `format_settings_json` only — **no taxonomy columns** | Format editor panel within division card |
| 5 | `components/features/events/CreateEventForm.tsx` | 113 | `events` | INSERT | `min_skill_level`, `max_skill_level` (legacy numeric) | Create event form |
| 6 | `components/features/events/EditEventForm.tsx` | 94 | `events` | UPDATE | **none** — skill fields absent entirely | Event edit form |
| 7 | `app/api/events/[id]/cancel/route.ts` | 29 | `events` | UPDATE | `status: 'cancelled'` only | Cancel API route |
| 8 | `app/api/stripe/webhook/route.ts` | 174 | `events` | UPDATE | `status: 'full'` only | Stripe webhook |

**New columns (`skill_min`, `skill_max`, `format` on divisions) are written by zero active write sites.** Every write populates only legacy columns. Phase 2 changes sites 1, 2, 3, and 5.

Sites 4, 6, 7, 8 do not touch any taxonomy column and require no changes in Phase 2.

### Out-of-scope flag (see §6 Open Questions)

`app/(app)/compete/tournaments/create/CreateTournamentForm.tsx:95` — writes `category` and `skill_level` to `tournament_events`, not `tournament_divisions`. This is the old `/compete/tournaments/` path. `tournament_events` is a distinct table not covered by Phase 1. Flagged for dead-code audit before Phase 2 ships.

### RPC check

Three `.rpc(` calls found in the app:
- `app/api/events/[id]/leave/route.ts:28` — `rpc('leave_event', ...)` — no taxonomy columns
- `app/api/tournaments/[id]/checkout/route.ts:138` — `rpc('increment_discount_uses', ...)` — no taxonomy columns
- `app/api/stripe/webhook/route.ts:68` — `rpc('increment_discount_uses', ...)` — no taxonomy columns

**No RPC writes to any of the three target tables.**

---

## 2. Type and Constant Inventory

| File | Name | Current meaning |
|---|---|---|
| `components/features/tournaments/DivisionsSection.tsx:15` | `CATEGORY_LABELS` | Maps legacy `category` DB values to display strings: `mens_doubles → 'Men'`, `womens_doubles → 'Women'`, `mixed_doubles → 'Mixed'`, `singles → 'Singles'`, `open → 'Open'` |
| `components/features/tournaments/DivisionsSection.tsx:23` | `SKILL_OPTIONS` | Array of **Title Case** strings for the skill dropdown: `['Beginner', 'Beginner Plus', 'Intermediate', 'Intermediate Plus', 'Advanced', 'Open']` — these values are written directly to `skill_level` |
| `app/(app)/compete/leagues/create/CreateLeagueForm.tsx:9` | `FORMAT_OPTIONS` | Dropdown options for `leagues.format` — includes stale `{ value: 'singles', label: 'Singles' }` that fails the Phase 1 DB constraint (see §6 Open Question 1) |
| `app/(app)/compete/leagues/create/CreateLeagueForm.tsx:19` | `SKILL_OPTIONS` | Lowercase strings for `skill_level`: `'beginner' \| 'beginner_plus' \| 'intermediate' \| 'intermediate_plus' \| 'advanced'` — Note: no `'advanced_plus'` exposed in UI despite Phase 1 backfill mapping it |
| `app/(app)/compete/leagues/[id]/edit/page.tsx:9` | `FORMAT_OPTIONS` | Same as create form including stale `'singles'` |
| `app/(app)/compete/leagues/[id]/page.tsx:12` | `FORMAT_LABELS` | Display map for `leagues.format` — read-side only |
| `app/(app)/compete/leagues/[id]/page.tsx:22` | `SKILL_LABELS` | Display map for `leagues.skill_level` — read-side only |
| `app/(app)/compete/CompeteClient.tsx:18` | `SKILL_LEVEL_TO_TIER` | Maps legacy `skill_level` strings to UI filter chips — read-side only |
| `app/(app)/home/page.tsx:8` | `FORMAT_LABELS` | Duplicate of the one in `leagues/[id]/page.tsx` — read-side |
| `app/(app)/home/page.tsx:18` | `SKILL_LABELS` | Duplicate — read-side |
| `app/(app)/home/page.tsx:26` | `ALL_SKILL_TIERS` | Array of skill tier strings used for filtering events by `skill_level` — read-side |
| `app/api/league-register/route.ts:10` | `FORMAT_LABELS` | Duplicate in API route for email rendering — read-side |
| `app/api/league-register/route.ts:20` | `SKILL_LABELS` | Duplicate in API route — read-side |
| `app/api/stripe/webhook/route.ts:10` | `FORMAT_LABELS` | Duplicate in Stripe webhook — read-side |
| `app/api/stripe/webhook/route.ts:20` | `SKILL_LABELS` | Duplicate in Stripe webhook — read-side |
| `app/api/leagues/[id]/members/route.ts:76` | `FORMAT_LABELS` | Duplicate for member invite email — read-side |
| `components/features/tournaments/FormatSettingsFields.tsx:20` | `FORMAT_DEFAULTS` | Defaults per `format_type` (bracket algorithm) — unrelated to taxonomy columns |

**Surprising finding:** `FORMAT_LABELS` and `SKILL_LABELS` are duplicated in at least 5 files. They are read-side only (email rendering, display), so they don't block Phase 2 — but they create a maintenance surface. Flagging without action.

**Surprising finding:** Leagues `SKILL_OPTIONS` exposes 5 tiers but the Phase 1 backfill maps 6 (`advanced_plus` → 4.5/5.0). `advanced_plus` cannot be set through any current UI path.

---

## 3. Input Shape Map

### `leagues`

**User submits:**
- `format` — string from `FORMAT_OPTIONS` dropdown; already uses canonical Phase 1 enum values except for the stale `'singles'` entry
- `skill_level` — string from `SKILL_OPTIONS` dropdown; lowercase: `'beginner' | 'beginner_plus' | 'intermediate' | 'intermediate_plus' | 'advanced'`

**Where it lands:**
- Both values go directly from component state into the `.insert()` / `.update()` payload with no transformation layer
- `skill_min`, `skill_max` — **not collected, not written**

**Translation needed for Phase 2:** `skill_level` string → `skill_min` + `skill_max` numeric pair (see §4 mapping table B). `format` already canonical — no translation needed. Helper only needs to derive the two new numeric columns.

---

### `tournament_divisions`

**User submits:**
- `category` — string from hardcoded `<option>` elements: `'mixed_doubles' | 'mens_doubles' | 'womens_doubles' | 'singles' | 'open'`
- `team_type` — string: `'doubles' | 'singles'`
- `skill_level` — string from `SKILL_OPTIONS` array: **Title Case** `'Beginner' | 'Beginner Plus' | 'Intermediate' | 'Intermediate Plus' | 'Advanced' | 'Open'` (or empty string for "Any")

**Where it lands:**
- All three go directly into the `.insert()` payload at `DivisionsSection.tsx:172–177`
- `format`, `skill_min`, `skill_max` — **not collected, not written**
- The format-editor UPDATE (site 4) writes only `format_type` + `format_settings_json` — no taxonomy columns, no change needed

**Translation needed for Phase 2:** `(category, team_type)` → `format` (see §4 mapping table A). Title Case `skill_level` → `skill_min` + `skill_max` (see §4 mapping table C).

**Note:** There is no edit path for `category` / `skill_level` / `team_type` after creation. Once a division is inserted, these fields appear read-only in the UI. If that's intentional, there are only **two** write sites for `tournament_divisions` (insert + format-only update) and only the insert needs the Phase 2 helper.

---

### `events`

**User submits:**
- `minSkill` — string (raw text input value), converted via `parseFloat(minSkill)` at `CreateEventForm.tsx:104`
- `maxSkill` — string, same conversion

**Where it lands:**
- `min_skill_level` and `max_skill_level` written as float | null
- `skill_min`, `skill_max` — **not written**

**EditEventForm** — skill fields are absent from both the Props type and the update payload. Skill is set at creation and never editable. If that's intentional, the event helper only needs to handle CREATE (one write site).

**Translation needed for Phase 2:** `min_skill_level` → `skill_min`, `max_skill_level` → `skill_max`. The values are already numeric — a direct copy, no parsing. The event helper is the simplest of the three.

---

## 4. Format Mapping Tables

### A. `tournament_divisions` — `(category, team_type)` → `format`

Exact port of `supabase/migrations/20260514000001_taxonomy_phase1.sql` Section 4 CASE block.

| `category` | `team_type` | → `format` |
|---|---|---|
| `'mens_doubles'` | `'doubles'` | `'mens_doubles'` |
| `'womens_doubles'` | `'doubles'` | `'womens_doubles'` |
| `'mixed_doubles'` | `'doubles'` | `'mixed_doubles'` |
| `'singles'` | `'singles'` | `'mens_singles'` |
| `'open'` | `'singles'` | `'open_singles'` |
| `'mens_doubles'` | `'singles'` | `'mens_singles'` (mismatch: gender wins) |
| `'womens_doubles'` | `'singles'` | `'womens_singles'` (mismatch: gender wins) |
| `'mixed_doubles'` | `'singles'` | `'open_singles'` (mismatch: no clean gender) |
| any | `'doubles'` | `'mixed_doubles'` (fallback) |
| any | `'singles'` | `'open_singles'` (fallback) |
| else | else | `'mixed_doubles'` (final fallback) |

The TypeScript helper is a direct transcription of this logic.

---

### B. `leagues` — `skill_level` (lowercase) → `skill_min` / `skill_max`

From migration Section 6.

| `skill_level` | `skill_min` | `skill_max` |
|---|---|---|
| `'beginner'` | `2.0` | `2.5` |
| `'beginner_plus'` | `2.5` | `3.0` |
| `'intermediate'` | `3.0` | `3.5` |
| `'intermediate_plus'` | `3.5` | `4.0` |
| `'advanced'` | `4.0` | `4.5` |
| `'advanced_plus'` | `4.5` | `5.0` |
| anything else / null | `null` | `null` |

---

### C. `tournament_divisions` — `skill_level` (Title Case) → `skill_min` / `skill_max`

From migration Section 5. Note the **Title Case** keys — different from leagues (lowercase).

| `skill_level` | `skill_min` | `skill_max` |
|---|---|---|
| `'Beginner'` | `2.0` | `2.5` |
| `'Intermediate'` | `3.0` | `3.5` |
| `'Advanced'` | `4.0` | `4.5` |
| anything else / null | `null` | `null` |

**Note:** Divisions only expose 3 tiers (Beginner / Intermediate / Advanced) vs leagues which expose 5 in UI (6 in data). 'Beginner Plus', 'Intermediate Plus', and 'Open' are in the `SKILL_OPTIONS` array but map to `null` in the Phase 1 migration because there was no corresponding backfill mapping for them. The helper must handle these as null.

---

## 5. Helper Design Proposal

**No implementation here — signatures and return shapes only.**

Proposed location: `lib/taxonomy/write-helpers.ts` (new file, imported by all four write sites).

---

### `prepareLeagueWrite`

```ts
function prepareLeagueWrite(input: {
  format: string        // from FORMAT_OPTIONS dropdown, already canonical
  skillLevel: string    // lowercase string from SKILL_OPTIONS
}): {
  format: string        // pass-through (already canonical)
  skill_level: string   // pass-through (legacy, preserved for Phase 2)
  skill_min: number | null   // derived from skillLevel via mapping table B
  skill_max: number | null   // derived from skillLevel via mapping table B
}
```

Called by: `CreateLeagueForm.tsx` (site 1), `leagues/[id]/edit/page.tsx` (site 2).

---

### `prepareDivisionWrite`

```ts
function prepareDivisionWrite(input: {
  category: string     // from <option> dropdown: 'mens_doubles' | 'womens_doubles' | 'mixed_doubles' | 'singles' | 'open'
  teamType: string     // 'doubles' | 'singles'
  skillLevel: string   // Title Case from SKILL_OPTIONS, or '' for "Any"
}): {
  category: string          // pass-through (legacy)
  team_type: string         // pass-through (legacy)
  skill_level: string | null  // pass-through (legacy, null when empty)
  format: string            // derived from (category, teamType) via mapping table A
  skill_min: number | null  // derived from skillLevel via mapping table C
  skill_max: number | null  // derived from skillLevel via mapping table C
}
```

Called by: `DivisionsSection.tsx` INSERT (site 3) only. The format-editor UPDATE (site 4) writes different columns and needs no helper.

---

### `prepareEventWrite`

```ts
function prepareEventWrite(input: {
  minSkill: string | null   // raw input value, may be '' or null
  maxSkill: string | null   // raw input value, may be '' or null
}): {
  min_skill_level: number | null  // parseFloat or null (legacy)
  max_skill_level: number | null  // parseFloat or null (legacy)
  skill_min: number | null        // same numeric value as min_skill_level
  skill_max: number | null        // same numeric value as max_skill_level
}
```

Called by: `CreateEventForm.tsx` INSERT (site 5) only. The edit form (site 6) does not write skill columns and needs no change.

**Note:** Events already store skill as numeric — no string-to-number mapping table needed. The helper is a thin normalization wrapper, not a translator.

---

## 6. Open Questions

These require your decision before building.

### Q1 — `'singles'` in `FORMAT_OPTIONS` (leagues)

`CreateLeagueForm.tsx:16` and `leagues/[id]/edit/page.tsx:16` both include `{ value: 'singles', label: 'Singles' }` in the format dropdown. `'singles'` is **not** a valid value under the Phase 1 `leagues_format_check` constraint. Any form submission with this selection will produce a DB error.

**Options:**
- A) Remove `'singles'` from FORMAT_OPTIONS entirely — the league list shows 'Mixed Doubles', 'Individual Round Robin', etc. A plain "Singles" league should be `'mens_singles'`, `'womens_singles'`, or `'open_singles'`.
- B) Map `'singles'` → `'mens_singles'` inside `prepareLeagueWrite` as a compatibility shim for the one edge case where someone picks it.
- C) Keep as-is and let it fail loudly — which is what Phase 1 intended.

**Recommendation:** Option A. Remove the stale option, add the three canonical singles options. The Phase 2 build prompt should include this as a required change at the same time as the helper.

---

### Q2 — Event skill fields: intentionally not editable?

`EditEventForm` has no skill fields in its Props type or update payload. This means skill is set once at creation and immutable. Is this by design, or a gap to fill?

If intentional: Phase 2 only touches `CreateEventForm.tsx` (site 5). EditEventForm is out of scope.

If skill should be editable: EditEventForm needs skill fields added (both input UI and write payload), and `prepareEventWrite` needs to be called from there too.

---

### Q3 — `tournament_events` table scope

`app/(app)/compete/tournaments/create/CreateTournamentForm.tsx:95` inserts `category` and `skill_level` into a `tournament_events` table. This is **not** `tournament_divisions` and was not part of Phase 1.

The active tournament system is at `/tournaments/[id]` (using `tournament_divisions`). The `/compete/tournaments/` path appears to be the old system.

**Decision needed:** Is `tournament_events` dead code, or is it still live? If dead code, Phase 2 excludes it and the `compete/tournaments/create` page should be flagged for removal. If still live, Phase 2 must also cover `tournament_events` — which requires a Phase 1-equivalent migration for that table first.

---

### Q4 — Division taxonomy fields: immutable after creation?

The `DivisionsSection` add-form (site 3) is the only INSERT path for `tournament_divisions`. The only UPDATE path (site 4) writes `format_type` and `format_settings_json` — it explicitly does NOT update `category`, `skill_level`, or `team_type`.

This means once a division is created, its taxonomy fields (`category`, `skill_level`, `team_type`, and after Phase 2: `format`, `skill_min`, `skill_max`) cannot be changed through the UI.

**Confirm:** Is this intentional? If so, site 3 is the **only** write site for `prepareDivisionWrite`. If division taxonomy should be editable, an update path must be added — but that's a new feature, not Phase 2 scope.

---

### Q5 — Skill level casing inconsistency: accept as-is?

Leagues write lowercase `'intermediate'`; divisions write Title Case `'Intermediate'`. This is a pre-existing inconsistency. Phase 2 will need two separate mapping tables (B and C above) to handle both.

The helpers can encapsulate this difference internally. But if the goal is eventually to normalize skill storage to a single format (e.g., numeric-only, dropping the string columns in Phase 3), the mapping tables become dead code at that point.

**Confirm:** No change to casing in Phase 2 — just handle both in the helpers? Or take the opportunity to normalize the input before storage?
