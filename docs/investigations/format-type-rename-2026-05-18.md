# Ticket 4.1.5 — `format_type` → `bracket_type` Rename Audit

**Date:** 2026-05-18
**Type:** Read-only investigation — no code changes, no migrations, no commits
**Precursor investigation:** [format-type-vs-format-2026-05-18.md](format-type-vs-format-2026-05-18.md) (decision to rename already made)
**Decision logged in:** [docs/decisions.md](../decisions.md) — 2026-05-18 entry

---

## 1. Current app code references

Grep of entire codebase (`.claude/worktrees/` excluded — stale worktree copies, not canonical).

| File | Line | Reference type |
|---|---|---|
| `app/(app)/tournaments/[id]/page.tsx` | 70 | `.select()` string: `'...format_type...'` |
| `app/(app)/tournaments/[id]/page.tsx` | 254 | Object spread: `format_type: d.format_type` |
| `app/(app)/tournaments/[id]/organizer/_components/types.ts` | 32 | Type definition: `format_type: string` |
| `components/features/tournaments/DivisionsSection.tsx` | 48 | Type definition: `format_type: FormatType` |
| `components/features/tournaments/DivisionsSection.tsx` | 180 | INSERT payload: `format_type: fFormatType` |
| `components/features/tournaments/DivisionsSection.tsx` | 187 | `.select()` string: `'...format_type...'` |
| `components/features/tournaments/DivisionsSection.tsx` | 203 | Read: `setEditFormatType(div.format_type)` |
| `components/features/tournaments/DivisionsSection.tsx` | 204 | Read: `FORMAT_DEFAULTS[div.format_type]` |
| `components/features/tournaments/DivisionsSection.tsx` | 220 | UPDATE payload: `format_type: editFormatType` |
| `components/features/tournaments/DivisionsSection.tsx` | 227 | State update: `{ ...d, format_type: editFormatType }` |
| `components/features/tournaments/DivisionsSection.tsx` | 746 | Read: `div.format_type ?? 'round_robin'` |
| `components/features/tournaments/FormatSettingsFields.tsx` | 92 | HTML `name="format_type"` on radio input — **NOT a DB reference** |
| `components/features/tournaments/MatchesSection.tsx` | 37 | Type definition: `format_type: string` |
| `components/features/tournaments/MatchesSection.tsx` | 378 | Render: `div.format_type.replace(/_/g, ' ')` |
| `components/features/tournaments/MatchesSection.tsx` | 415 | Logic: `showsBracket(div.format_type)` |
| `components/features/tournaments/MatchesSection.tsx` | 433 | Logic: `!showsBracket(div.format_type)` |
| `components/features/tournaments/MatchesSection.tsx` | 439 | Logic: `showsStandings(div.format_type)` |
| `app/api/tournaments/[id]/divisions/route.ts` | 17 | `.select()` string: `'...format_type...'` |
| `app/api/tournaments/[id]/generate-all/route.ts` | 35 | `.select()` string: `'...format_type...'` |
| `app/api/tournaments/[id]/generate-all/route.ts` | 71 | `division.format_type as string` |
| `app/api/tournaments/[id]/divisions/[divisionId]/generate-matches/route.ts` | 46 | `.select()` string: `'...format_type...'` |
| `app/api/tournaments/[id]/divisions/[divisionId]/generate-matches/route.ts` | 65 | `division.format_type as string` |

**Total: 22 references across 8 files** (one HTML-only, 21 DB-touching).

### Delta vs May 14 audit

May 14 audit listed 15 references across 6 files. Differences:

- **New file since May 14:** `app/(app)/tournaments/[id]/organizer/_components/types.ts` (line 32) — `OrgDivision.format_type: string`. Added when the tournament organizer live view was built (2026-05-11 session). One new reference, one new file.
- **Line number shifts in DivisionsSection.tsx:** Phase 2 wiring added ~10 lines. May 14 referenced lines 181/188/221; now 180/187/220. Same sites, shifted by one line from an unrelated change.
- **FormatSettingsFields.tsx line 92** was listed as a reference site in the May 14 audit but is an HTML `name=` attribute, not a DB interaction. Flagged explicitly here for clarity.

---

## 2. Database-level references

### CHECK constraints on `tournament_divisions`

| Constraint name | Definition |
|---|---|
| `tournament_divisions_format_type_check` | `CHECK (format_type IN ('round_robin','single_elimination','double_elimination','pool_play_playoffs'))` |
| `tournament_divisions_category_check` | `CHECK (category IN ('mens_doubles','womens_doubles','mixed_doubles','singles','open'))` |
| `tournament_divisions_status_check` | `CHECK (status IN ('draft','active','closed'))` |
| `tournament_divisions_team_type_check` | `CHECK (team_type IN ('singles','doubles'))` |
| `tournament_divisions_pkey` | `PRIMARY KEY (id)` |
| `tournament_divisions_tournament_id_fkey` | `FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE` |

The rename migration must address `tournament_divisions_format_type_check`. PostgreSQL automatically updates the CHECK constraint body when a column is renamed — the `CHECK (format_type IN (...))` expression will automatically become `CHECK (bracket_type IN (...))`. **The constraint name however does not auto-update** — it stays `tournament_divisions_format_type_check` unless explicitly renamed.

### Triggers on `tournament_divisions`

| Trigger | Definition |
|---|---|
| `divisions_updated_at` | `BEFORE UPDATE ... EXECUTE FUNCTION update_updated_at_column()` |

This trigger fires on every UPDATE to keep `updated_at` current. It does not reference `format_type` by name — it runs unconditionally on any row update. **No action needed.**

### RLS policies on `tournament_divisions`

| Policy | USING expression | WITH CHECK expression |
|---|---|---|
| `divisions_read` | `true` | — |
| `divisions_organizer_insert` | — | `EXISTS (SELECT 1 FROM tournaments WHERE tournaments.id = tournament_divisions.tournament_id AND tournaments.organizer_id = auth.uid())` |
| `divisions_organizer_update` | same as above | — |
| `divisions_organizer_delete` | same as above | — |

None of the four policies reference `format_type`. All checks are on `tournament_id → organizer_id`. **No action needed.**

### Functions and views referencing `format_type`

- `information_schema.routines` query: **zero results** — no stored functions reference `format_type`
- `information_schema.views` query: **zero results** — no views reference `format_type`

The column is purely application-side: no server-side logic touches it beyond the CHECK constraint.

---

## 3. Generated TypeScript types

**There is no generated `database.types.ts` file in this project.** The Supabase `generate_typescript_types` command has not been run to produce a client-side type file. All TypeScript types are manually authored inline:

| Location | Shape |
|---|---|
| `components/features/tournaments/FormatSettingsFields.tsx:3` | `export type FormatType = 'round_robin' \| 'single_elimination' \| 'double_elimination' \| 'pool_play_playoffs'` |
| `components/features/tournaments/DivisionsSection.tsx:48` | `format_type: FormatType` (in the local `Division` type) |
| `components/features/tournaments/MatchesSection.tsx:37` | `format_type: string` (in the local division type) |
| `app/(app)/tournaments/[id]/organizer/_components/types.ts:32` | `format_type: string` (in `OrgDivision`) |

Because there is no generated types file, the TypeScript compiler will not auto-catch missed column name references in `.select()` strings (those are plain strings, not typed). It **will** catch missed references in:
- Type definitions (the four locations above, once renamed)
- Object spreads like `format_type: d.format_type` once the type definition is updated

The recommended mitigation stands: after applying the migration, run `npx supabase gen types typescript` to produce a `database.types.ts` and widen the TypeScript net. This is optional for this ticket but is the right time to introduce it.

---

## 4. Migration plan (draft — do NOT apply)

```sql
-- Migration: rename format_type → bracket_type on tournament_divisions
-- Ticket 4.1.5
-- 
-- NOT IDEMPOTENT: will fail with "column format_type does not exist"
-- if re-run after the column is already renamed.
-- Apply once only. Recovery: see rollback plan below.

BEGIN;

-- Step 1: rename the column
ALTER TABLE tournament_divisions
  RENAME COLUMN format_type TO bracket_type;

-- Step 2: rename the CHECK constraint
-- PostgreSQL auto-updates the constraint body (the IN list will now read
-- bracket_type = ANY (...)), but the constraint NAME does not change.
ALTER TABLE tournament_divisions
  RENAME CONSTRAINT tournament_divisions_format_type_check
  TO tournament_divisions_bracket_type_check;

COMMIT;
```

**Side effects of Step 1 (automatic, no extra SQL needed):**
- The CHECK constraint body updates automatically: `CHECK (bracket_type IN ('round_robin', ...))` — correct.
- The `divisions_updated_at` trigger is unaffected (runs on any UPDATE, not column-specific).
- All four RLS policies are unaffected (none reference the column).
- No views or functions to update.

**After migration, app code changes required in these files:**
- `app/(app)/tournaments/[id]/page.tsx` (lines 70, 254)
- `app/(app)/tournaments/[id]/organizer/_components/types.ts` (line 32)
- `components/features/tournaments/DivisionsSection.tsx` (lines 48, 180, 187, 203, 204, 220, 227, 746)
- `components/features/tournaments/FormatSettingsFields.tsx` (line 92 — HTML attribute, cosmetic)
- `components/features/tournaments/MatchesSection.tsx` (lines 37, 378, 415, 433, 439)
- `app/api/tournaments/[id]/divisions/route.ts` (line 17)
- `app/api/tournaments/[id]/generate-all/route.ts` (lines 35, 71)
- `app/api/tournaments/[id]/divisions/[divisionId]/generate-matches/route.ts` (lines 46, 65)

The `FormatType` TypeScript type alias and the local variable names (`fFormatType`, `editFormatType`, etc.) may also be renamed for full consistency — TypeScript will flag these once the `Division` type is updated.

---

## 5. Rollback plan

If the migration succeeds but the app code change introduces a bug:

```sql
-- Rollback: restore format_type on tournament_divisions
-- Run only if bracket_type rename migration was applied and needs reverting.

BEGIN;

ALTER TABLE tournament_divisions
  RENAME COLUMN bracket_type TO format_type;

ALTER TABLE tournament_divisions
  RENAME CONSTRAINT tournament_divisions_bracket_type_check
  TO tournament_divisions_format_type_check;

COMMIT;
```

After rollback, revert the app code changes in the same PR (revert the PR, don't cherry-pick). The migration and the app code are one atomic unit — never ship either without the other.

---

## 6. Open questions

### Q1 — Rename the CHECK constraint name?

**Options:**
- **A (rename it):** `tournament_divisions_format_type_check` → `tournament_divisions_bracket_type_check`. Consistent with the new column name. Anyone reading `\d tournament_divisions` in psql sees a self-documenting name. Migration SQL is one extra line.
- **B (leave it):** Constraint names have zero functional impact. The body auto-updates correctly regardless of the name. Keeping the old name preserves a git-blame breadcrumb linking back to `20260501000002_tournament_format_settings.sql`.

**Recommendation:** Rename it. The archaeology argument is thin — the migration file and git log document the history better than a constraint name. A constraint called `_format_type_check` on a column called `bracket_type` is confusing enough to cause future "is this stale?" questions.

### Q2 — Rename the `FormatType` TypeScript alias?

The type alias `FormatType` in `FormatSettingsFields.tsx` has no direct connection to the DB column name — it's an app-level type. Options:
- **A (rename to `BracketType`):** Consistent with the rename. Would update all four local type usages via TypeScript compiler enforcement.
- **B (leave as `FormatType`):** Avoids cosmetic churn; the type is already correct and well-understood.

**Recommendation:** Rename to `BracketType` for the same reason we're doing the column rename — `FormatType` sitting next to `format` (the new gender/composition column type) is exactly the naming confusion we're eliminating.

### Q3 — Rename local variable names (`fFormatType`, `editFormatType`)?

These are React state variables in `DivisionsSection.tsx`. Functionally irrelevant — TypeScript won't enforce these. Renaming to `fBracketType`/`editBracketType` is cosmetically consistent but adds noise to the PR diff.

**Recommendation:** Yes, rename them in the same PR. The PR touches these files anyway; leaving mismatched variable names creates future confusion for the same reasons the column name did.

### Q4 — HTML `name="format_type"` attribute (FormatSettingsFields.tsx:92)?

This is a radio group HTML `name` attribute — it groups radio buttons for browser form behavior. It has no DB interaction and no effect on the app's Supabase queries. Renaming it to `name="bracket_type"` is purely cosmetic.

**Recommendation:** Rename it in the same PR pass. Costs nothing.
