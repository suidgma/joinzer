# `format_type` vs `format` — Investigation Report

**Date:** 2026-05-18
**Type:** Read-only investigation — no code changes, no migrations, no commits
**Decision logged in:** [docs/decisions.md](../decisions.md) — 2026-05-18 entry
**Outcome:** Rename `format_type` → `bracket_type` scheduled as ticket 4.1.5

---

## 1. What is `format_type`?

**DB query result:**

| format_type | count |
|---|---|
| `round_robin` | 22 |
| `single_elimination` | 1 |

**Column definition** (`information_schema.columns`):

| column | data_type | default | nullable | constraint |
|---|---|---|---|---|
| `format_type` | text | `'round_robin'` | NO | CHECK IN ('round_robin','single_elimination','double_elimination','pool_play_playoffs') |
| `format` | text | null | YES | none |

**Distinct values in use:** `round_robin` (22 rows), `single_elimination` (1 row). The constraint also permits `double_elimination` and `pool_play_playoffs` but neither appears in live data yet.

**Origin:** Added in migration `supabase/migrations/20260501000002_tournament_format_settings.sql` alongside `format_settings_json`.

---

## 2. What is `format_type` semantically?

It is **tournament structure** — the bracket/schedule algorithm that determines how matches are generated. It has nothing to do with gender composition or team size.

**Every read and write, canonical files only** (`.claude/worktrees/` excluded as stale copies):

| File | Line | Operation |
|---|---|---|
| `supabase/migrations/20260501000002_tournament_format_settings.sql` | 2–3 | DDL: ADD COLUMN with CHECK constraint |
| `components/features/tournaments/FormatSettingsFields.tsx` | 3 | Type definition: `FormatType` union |
| `components/features/tournaments/FormatSettingsFields.tsx` | 20–35 | `FORMAT_DEFAULTS` and `FORMAT_META` — labels, descriptions, defaults per type |
| `components/features/tournaments/FormatSettingsFields.tsx` | 37–65 | `validateFormatSettings`, `formatSummaryLines` — UI logic driven entirely by this column |
| `components/features/tournaments/FormatSettingsFields.tsx` | 84–106 | Radio button group — organizer picks `format_type` when creating/editing a division |
| `components/features/tournaments/DivisionsSection.tsx` | 181, 188, 221 | Write on insert and update |
| `components/features/tournaments/DivisionsSection.tsx` | 204–205 | Read to populate edit form |
| `components/features/tournaments/DivisionsSection.tsx` | 747–749 | Read to compute `formatSummaryLines` for the division card |
| `components/features/tournaments/MatchesSection.tsx` | 333–334 | `showsBracket`, `showsStandings` — controls which UI panels render |
| `components/features/tournaments/MatchesSection.tsx` | 378 | Display: rendered as `"round robin"` etc. in the division header |
| `components/features/tournaments/MatchesSection.tsx` | 415, 433, 439 | Conditional rendering of bracket view, flat match list, standings table |
| `app/(app)/tournaments/[id]/page.tsx` | 70, 254 | Read: selected from DB, passed through to components |
| `app/api/tournaments/[id]/divisions/route.ts` | 17 | Read: selected in divisions list API |
| `app/api/tournaments/[id]/divisions/[divisionId]/generate-matches/route.ts` | 46, 65–93 | **Core use**: branches match generation algorithm |
| `app/api/tournaments/[id]/generate-all/route.ts` | 35, 71 | Same branching logic, bulk version |

**Proof of meaning** — the most authoritative lines in the codebase:

```ts
// app/api/tournaments/[id]/divisions/[divisionId]/generate-matches/route.ts:65–93
const ft = division.format_type as string
if (ft === 'single_elimination') {
  matchRows = singleEliminationBracket(...)
} else if (ft === 'double_elimination') {
  matchRows = doubleEliminationBracket(...)
} else if (ft === 'pool_play_playoffs') {
  matchRows = poolPlayMatches(...)
} else {
  // round_robin: all vs all in a single pool
}
```

```ts
// components/features/tournaments/MatchesSection.tsx:333–334
const showsStandings = (ft: string) => ft === 'round_robin' || ft === 'pool_play_playoffs'
const showsBracket = (ft: string) => ft === 'single_elimination' || ft === 'double_elimination' || ft === 'pool_play_playoffs'
```

`format_type` is the **match generation algorithm selector**. It determines what SQL rows get inserted into `tournament_matches` and what UI panels render (bracket view vs. standings table vs. flat list). It is completely orthogonal to gender or team composition.

---

## 3. How does it overlap with the new `format` column?

**The new `format` enum values:**
`mens_singles`, `womens_singles`, `open_singles`, `mens_doubles`, `womens_doubles`, `mixed_doubles`, `coed_doubles`, `open_doubles`, `individual_round_robin`, `custom`

**The `format_type` values:**
`round_robin`, `single_elimination`, `double_elimination`, `pool_play_playoffs`

**Value-level overlap:** Zero. Not a single string appears in both sets.

**Concept-level overlap:** One partial case — `individual_round_robin` in the new `format` enum. This is a gender/team format value meaning "every player plays as an individual in a round-robin style game" — it describes who participates, not how the bracket works. The `round_robin` value in `format_type` describes the scheduling algorithm. They are related concepts but represent different axes of the same division:

| Axis | Column | Values |
|---|---|---|
| Who plays / gender / team composition | `format` | `mens_doubles`, `mixed_doubles`, `individual_round_robin`, etc. |
| How matches are structured / bracket | `format_type` | `round_robin`, `single_elimination`, etc. |

A `mixed_doubles` division could run either `round_robin` or `single_elimination`. An `individual_round_robin` division will almost always use `round_robin` as its `format_type`, but the constraint doesn't enforce that — and shouldn't, because the two axes are independent.

**Gaps:**
- Concepts in `format_type` with no equivalent in `format`: none — they address a different axis entirely.
- Concepts in `format` with no equivalent in `format_type`: none — same reason.
- No value needs to be moved, merged, or reconciled. These columns answer different questions.

---

## 4. Three options

### Option A — Rename `format_type` to `bracket_type`

**What changes:**
- Schema: `ALTER TABLE tournament_divisions RENAME COLUMN format_type TO bracket_type;`
- App code: all 15 reads/writes across 6 files updated to `bracket_type`
- TypeScript: `FormatType` type alias and all variable names (`fFormatType`, `editFormatType`) renamed
- Dual-write: not applicable — this is a rename, not a data change; one migration, one PR
- Phase 3: nothing — `format_type` column gone after rename migration

**Tradeoffs:**
- Pro: removes the naming confusion permanently; `bracket_type` and `format` are now self-documenting
- Pro: the CHECK constraint already enforces the right values; no data change needed
- Con: touches 6 files across the app; requires a coordinated migration + code PR
- Con: breaks any external consumers reading `format_type` (currently none visible, but worth checking Supabase RLS policies and any edge functions)

---

### Option B — Merge into one richer `format` column

**What changes:**
- The new `format` column would need to carry both the gender/team composition AND the bracket algorithm — e.g., `mens_doubles_round_robin`, `mixed_doubles_single_elimination`
- Schema: drop `format_type`, change `format` CHECK to permit combined values
- App code: all match generation logic reads from a single column; parsing/splitting required to recover algorithm
- Dual-write: would need to populate merged value on every division create/update
- Phase 3: drop `format_type` and old `category`/`team_type` together

**Tradeoffs:**
- Pro: one column instead of two for a conceptual "what is this division"
- Con: cartesian product of values (4 bracket types × 10 format types = up to 40 enum values) — combinatorially unmanageable
- Con: the two axes genuinely vary independently; merging them encodes a false coupling
- Con: most `format_type` logic (match generation, bracket rendering) only cares about the algorithm half; parsing a combined string to recover it adds fragility
- **Verdict: bad idea.** The axes are independent. Merging them creates more problems than it solves.

---

### Option C — Keep separate, document semantics in decisions.md

**What changes:**
- Schema: nothing
- App code: nothing
- decisions.md: one entry clarifying the two columns answer different questions
- Dual-write: Phase 2 only needs to write to the new `format` column; `format_type` continues unchanged on its own path

**Tradeoffs:**
- Pro: zero risk, zero migration, zero code churn — nothing breaks
- Pro: already working correctly in production; 22 of 23 divisions have valid data in both columns
- Con: the name `format_type` remains ambiguous alongside `format` — future engineers will ask this exact question again
- Con: documentation-only fixes rot; the next dev may not read decisions.md

---

## 5. Recommendation

**Option A — Rename `format_type` to `bracket_type`.**

The two columns are genuinely independent axes and should coexist permanently — Option B (merge) is a false simplification. The real problem is the name. `format_type` sitting next to `format` will cause confusion on every code review and every new-contributor onboarding forever. `bracket_type` makes the axis explicit and self-documenting without changing any behavior or data.

**When to execute:** Not now, and not in Phase 2. Phase 2 is strictly dual-write on the new `format` column — it should not touch `format_type` at all. Schedule the rename as ticket 4.1.5, between Phase 2 (4.1) and Phase 3 drop (4.2). It is a one-migration + one-PR change with no functional impact.

**Biggest risk:** There are 15 references to `format_type` across 6 files. A missed reference (e.g., in a Supabase RLS policy, an edge function, or a future type-generated client) would cause a silent runtime failure — the column would exist as `bracket_type` but the code would still query `format_type` and get null. The mitigation: run `generate_typescript_types` after the migration and let the TypeScript compiler catch every missed reference before shipping.

**Open follow-up:** In practice, does `format = individual_round_robin` always pair with `bracket_type = round_robin`? If these two values are always coupled in real data, normalization could eventually collapse them into a single concept. Not a blocker — revisit after Phase 3 when the column picture is clean.
