# Joinzer Taxonomy Migration Plan
**Format + Skill Level → one canonical taxonomy, app-wide**

This plan replaces three overlapping enums (Tournament Category × Team Type, League Format, Skill Level) with one canonical set, plus a numeric-range skill model. Goal: stop the "Singles in two dropdowns," "3.5 vs Intermediate Plus" and "Mixed vs Coed" footguns that show up everywhere from filters to brackets.

---

## 1. Canonical enums

### 1.1 `format` (single source of truth)

```ts
type Format =
  // Singles
  | 'mens_singles'
  | 'womens_singles'
  | 'open_singles'
  // Doubles
  | 'mens_doubles'
  | 'womens_doubles'
  | 'mixed_doubles'    // 1 male + 1 female per team (strict)
  | 'coed_doubles'     // any gender combo per team
  | 'open_doubles'     // any gender combo, typically 4.5+ skill
  // Other
  | 'individual_round_robin' // rotating partners, individual standings
  | 'custom';
```

**Display labels** (one place, e.g. `lib/format.ts`):

```ts
export const FORMAT_LABELS: Record<Format, string> = {
  mens_singles: "Men's Singles",
  womens_singles: "Women's Singles",
  open_singles: 'Open Singles',
  mens_doubles: "Men's Doubles",
  womens_doubles: "Women's Doubles",
  mixed_doubles: 'Mixed Doubles',
  coed_doubles: 'Coed Doubles',
  open_doubles: 'Open Doubles',
  individual_round_robin: 'Individual Round Robin',
  custom: 'Custom',
};

export const FORMAT_HELPER: Record<Format, string> = {
  mixed_doubles: 'One male + one female per team',
  coed_doubles: 'Any gender combination per team',
  open_doubles: 'Any gender combination, typically 4.5+ skill',
  individual_round_robin: 'Rotating partners; ranked as individuals',
  custom: 'Custom format with your own rules',
  // others: no helper
} as Partial<Record<Format, string>>;
```

**Derived helpers** (for UI logic, *never* stored):

```ts
export const isSingles = (f: Format) =>
  f === 'mens_singles' || f === 'womens_singles' || f === 'open_singles';

export const isDoubles = (f: Format) =>
  f === 'mens_doubles' || f === 'womens_doubles' ||
  f === 'mixed_doubles' || f === 'coed_doubles' || f === 'open_doubles';

export const requiresPartner = (f: Format) =>
  isDoubles(f); // every doubles format requires a partner field at registration

export const genderRestriction = (f: Format): 'male' | 'female' | null => {
  if (f === 'mens_singles' || f === 'mens_doubles') return 'male';
  if (f === 'womens_singles' || f === 'womens_doubles') return 'female';
  return null;
};

export const requiresMixedPair = (f: Format) => f === 'mixed_doubles';
```

**Why this shape**
- One column. One enum. Filters become equality checks, not joins across two columns.
- All "is this a doubles thing?" logic is one function call.
- Adding a new format later (e.g. `tri_level_doubles`) is one enum entry + one label.

### 1.2 Skill — numeric range, named tiers as presets

**Storage:**

```ts
// Profile (user)
{
  self_rating: number | null;  // 2.0 .. 8.0 in 0.5 steps; null = unrated
  // optional dual-system support if you ever wire DUPR:
  dupr_rating: number | null;
}

// Division / League / Session
{
  skill_min: number | null;    // null = no floor
  skill_max: number | null;    // null = no ceiling
  // "No skill filter" = both null
  // "3.5+" = { min: 3.5, max: null }
  // "3.0–3.5" = { min: 3.0, max: 3.5 }
}
```

**Named tier presets** (display + create-form quick-pick):

```ts
export const SKILL_TIERS = [
  { id: 'beginner',         label: 'Beginner',         min: 2.0, max: 2.5 },
  { id: 'beginner_plus',    label: 'Beginner+',        min: 2.5, max: 3.0 },
  { id: 'intermediate',     label: 'Intermediate',     min: 3.0, max: 3.5 },
  { id: 'intermediate_plus',label: 'Intermediate+',    label: 'Intermediate Plus', min: 3.5, max: 4.0 },
  { id: 'advanced',         label: 'Advanced',         min: 4.0, max: 4.5 },
  { id: 'advanced_plus',    label: 'Advanced+',        min: 4.5, max: 5.0 },
  { id: 'pro',              label: 'Pro / Open',       min: 5.0, max: null },
  { id: 'all_levels',       label: 'All levels',       min: null, max: null },
];
```

**"All levels" = no skill filter.** Use this label everywhere a no-filter division/league/session is created. Reserve the word "Open" for **doubles-event composition** (`open_doubles`, `open_singles`) only, where it means "no gender restriction." Two different concepts, two different labels — solves the ambiguity.

**Display rule** (one helper, used everywhere):

```ts
export function formatSkillRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return 'All levels';
  if (min === null) return `Up to ${max}`;
  if (max === null) return `${min}+`;
  if (min === max)  return `${min}`;
  return `${min}–${max}`;
}

// Reverse: given (min, max), is there a named tier that matches?
export function namedTierFor(min: number | null, max: number | null): SkillTier | null {
  return SKILL_TIERS.find(t => t.min === min && t.max === max) ?? null;
}
```

**Why this shape**
- One canonical mapping (numbers). Names are display-only.
- Filters compare numbers; never strings, never enums across systems.
- A profile rated 3.5 visibly matches a division "3.0–3.5", a league "Intermediate+", and a session "3.5+" — all using the same comparison.

### 1.3 Skill match rule

For a player with `self_rating = r` and a division/league/session with `(min, max)`:

```ts
const eligible =
  (min === null || r === null || r >= min) &&
  (max === null || r === null || r <= max);
```

Treat unrated (`r === null`) as **soft pass with warning** — let them register, but show "You haven't set a skill rating yet. Set it on your profile." This avoids gating new users out.

---

## 2. Schema changes

### 2.1 Tournament `divisions` table

```sql
-- Drop the broken category × team_type pair
ALTER TABLE divisions
  DROP COLUMN category,
  DROP COLUMN team_type;

-- Add the canonical format column
ALTER TABLE divisions
  ADD COLUMN format text NOT NULL DEFAULT 'mixed_doubles'
    CHECK (format IN (
      'mens_singles','womens_singles','open_singles',
      'mens_doubles','womens_doubles','mixed_doubles',
      'coed_doubles','open_doubles',
      'individual_round_robin','custom'
    ));

-- Skill range
ALTER TABLE divisions
  ADD COLUMN skill_min numeric(3,1) NULL CHECK (skill_min BETWEEN 1.0 AND 8.0),
  ADD COLUMN skill_max numeric(3,1) NULL CHECK (skill_max BETWEEN 1.0 AND 8.0),
  ADD CONSTRAINT divisions_skill_range CHECK (
    skill_min IS NULL OR skill_max IS NULL OR skill_min <= skill_max
  );

-- Drop the old skill string column once backfilled
ALTER TABLE divisions DROP COLUMN skill_level;
```

### 2.2 `leagues` table

```sql
-- format already exists with overlapping vocabulary — update CHECK to canonical set
ALTER TABLE leagues
  DROP CONSTRAINT IF EXISTS leagues_format_check;

ALTER TABLE leagues
  ADD CONSTRAINT leagues_format_check CHECK (format IN (
    'mens_singles','womens_singles','open_singles',
    'mens_doubles','womens_doubles','mixed_doubles',
    'coed_doubles','open_doubles',
    'individual_round_robin','custom'
  ));

-- Same skill range structure
ALTER TABLE leagues
  ADD COLUMN skill_min numeric(3,1) NULL,
  ADD COLUMN skill_max numeric(3,1) NULL,
  ADD CONSTRAINT leagues_skill_range CHECK (
    skill_min IS NULL OR skill_max IS NULL OR skill_min <= skill_max
  );

ALTER TABLE leagues DROP COLUMN skill_level;
```

### 2.3 `users` table (profile)

```sql
ALTER TABLE users
  ADD COLUMN self_rating numeric(3,1) NULL
    CHECK (self_rating BETWEEN 1.0 AND 8.0);

-- Optional: keep joinzer_level for backward read compatibility for one release,
-- but populate it as a generated/derived column from self_rating, OR drop it.
ALTER TABLE users DROP COLUMN joinzer_level;
```

### 2.4 Play `sessions` table

The `events` create form already uses `min_skill` + `max_skill` strings. Convert to numeric:

```sql
ALTER TABLE sessions
  ADD COLUMN skill_min numeric(3,1) NULL,
  ADD COLUMN skill_max numeric(3,1) NULL;

-- Backfill from existing min_skill/max_skill strings (see backfill section)

ALTER TABLE sessions
  DROP COLUMN min_skill,
  DROP COLUMN max_skill;
```

---

## 3. Data backfill

Run these as a single migration script. Each block is idempotent (uses `CASE` not `UPDATE WHERE`) so reruns are safe.

### 3.1 Skill string → numeric

```sql
-- Profile self_rating
UPDATE users SET self_rating = CASE joinzer_level
  WHEN 'beginner'           THEN 2.0
  WHEN 'beginner_plus'      THEN 2.5
  WHEN 'intermediate'       THEN 3.0
  WHEN 'intermediate_plus'  THEN 3.5
  WHEN 'advanced'           THEN 4.0
  WHEN 'advanced_plus'      THEN 4.5
  WHEN 'pro' or 'open'      THEN 5.0
  ELSE NULL
END
WHERE self_rating IS NULL;

-- Division skill_min / skill_max
UPDATE divisions SET
  skill_min = CASE skill_level
    WHEN 'beginner'          THEN 2.0
    WHEN 'beginner_plus'     THEN 2.5
    WHEN 'intermediate'      THEN 3.0
    WHEN 'intermediate_plus' THEN 3.5
    WHEN 'advanced'          THEN 4.0
    WHEN 'open'              THEN NULL  -- old "Open" = no filter
    WHEN 'any'               THEN NULL
    ELSE NULL
  END,
  skill_max = CASE skill_level
    WHEN 'beginner'          THEN 2.5
    WHEN 'beginner_plus'     THEN 3.0
    WHEN 'intermediate'      THEN 3.5
    WHEN 'intermediate_plus' THEN 4.0
    WHEN 'advanced'          THEN 4.5
    WHEN 'open'              THEN NULL
    WHEN 'any'               THEN NULL
    ELSE NULL
  END
WHERE skill_min IS NULL AND skill_max IS NULL;

-- Same for leagues, swap table name
-- Same for sessions, source columns are min_skill / max_skill (already numeric strings → cast)
```

### 3.2 Tournament division `category` × `team_type` → `format`

```sql
UPDATE divisions SET format = CASE
  WHEN category = 'mens_doubles'    AND team_type = 'doubles' THEN 'mens_doubles'
  WHEN category = 'womens_doubles'  AND team_type = 'doubles' THEN 'womens_doubles'
  WHEN category = 'mixed_doubles'   AND team_type = 'doubles' THEN 'mixed_doubles'
  WHEN category = 'open'            AND team_type = 'doubles' THEN 'open_doubles'

  WHEN category = 'singles'         AND team_type = 'singles' THEN 'open_singles'
  WHEN category = 'mens_doubles'    AND team_type = 'singles' THEN 'mens_singles'
  WHEN category = 'womens_doubles'  AND team_type = 'singles' THEN 'womens_singles'
  WHEN category = 'open'            AND team_type = 'singles' THEN 'open_singles'

  -- Inconsistent pairs (e.g. category='singles' AND team_type='doubles') get coerced
  -- using team_type as the primary signal, since that's what generates matches
  WHEN team_type = 'doubles' THEN 'mixed_doubles'  -- safest doubles default
  WHEN team_type = 'singles' THEN 'open_singles'
  ELSE 'mixed_doubles'
END
WHERE format IS NULL;
```

Audit the coerced rows before committing:

```sql
-- Report-only: any row that got coerced because the original combo was inconsistent
SELECT id, name, category, team_type, format
FROM divisions
WHERE (category = 'singles' AND team_type = 'doubles')
   OR (category = 'mens_doubles' AND team_type = 'singles')
   OR (category = 'womens_doubles' AND team_type = 'singles');
```

Flag these to the owner before the second migration step drops `category` and `team_type`.

### 3.3 League format normalization

Current league `format` enum already overlaps mostly. Just remap edge cases:

```sql
UPDATE leagues SET format = 'mixed_doubles' WHERE format = 'mixed';
UPDATE leagues SET format = 'mens_doubles'  WHERE format = 'mens';
-- Add any other historical strings you find
```

---

## 4. UI changes

Listed by screen, with the minimum code touched.

### 4.1 Profile (`/profile` + `/profile/edit`)

- Replace "Joinzer Level" dropdown with **Self-rating** picker (2.0 → 5.0+ in 0.5 steps, plus "Unrated").
- Display: `3.5 · Intermediate Plus` (derived from `namedTierFor`).
- Kill the dual "Estimated 3.5 ~3.5 est." copy — pick one source of truth.

### 4.2 Tournament division creation

- **Delete** the Category dropdown and the Team Type dropdown.
- **Add** a single **Format** dropdown with the canonical 10 values. Show `FORMAT_HELPER[format]` inline below the picker when relevant (Mixed Doubles, Coed Doubles, Open Doubles, Individual Round Robin, Custom).
- Replace Skill Level dropdown with the **dual-mode picker** (see §4.5).
- Derived form behavior: if `requiresPartner(format)`, the Add Player / Import / Self-register flows must have the partner field (already covered in the doubles-bug fixes).

### 4.3 League creation + edit

- Format dropdown: already exists, just update the option list + values to the canonical 10.
- Edit form: **add Win By, Sub Credit Cap, Points to Win, Max Players, Games/Play** to fix field-parity with Create (separate finding, but ships with this work).
- Replace Skill Level dropdown with the **dual-mode picker**.
- Lock Format and skill range once `registrant_count > 0` (or require confirmation modal).

### 4.4 Play session creation (`/events/create`)

- Already uses Min Skill / Max Skill — convert to numeric pickers (2.0 → 5.0+ in 0.5 steps, plus "No minimum" / "& up").
- No format field needed (Play sessions don't have a single format — they're open play). Skip this if it complicates things; leagues and tournaments are the priority.

### 4.5 The dual-mode skill picker (new shared component)

```tsx
<SkillRangePicker value={{min, max}} onChange={...} />
```

UI:

```
Skill level
○ All levels       (sets min=null, max=null)
● Quick pick       Beginner ▾  ← named tier dropdown, sets both
○ Custom range     Min: [3.0 ▾]  Max: [3.5 ▾]
```

Three radio modes. Quick pick is the default — covers 90% of cases. Custom is for tournaments that want odd ranges (e.g. "3.5–3.99 only"). "All levels" is one click.

Display in card / list views: `formatSkillRange(min, max)` — always the same helper.

### 4.6 Filters

Leagues index, Play feed, Tournaments index — every filter dropdown that currently says "Any skill" / numeric / named, replace with one filter that lets the user pick **their own rating** (or a target rating). The filter logic is one expression:

```ts
const matches =
  (min === null || userRating === null || userRating >= min) &&
  (max === null || userRating === null || userRating <= max);
```

Pre-select the filter to the user's `self_rating` on first load. "Show only events I'm eligible for" toggle.

### 4.7 Display strings

Anywhere `category`, `team_type`, `skill_level`, or `joinzer_level` is read for display, replace with `FORMAT_LABELS[format]` and `formatSkillRange(skill_min, skill_max)`. Grep audit:

```
git grep -nE "(category|team_type|skill_level|joinzer_level)" -- '*.tsx' '*.ts'
```

Each hit either:
- Reads from DB and needs updating to the new column, OR
- References the old enum and needs replacing with a label helper.

---

## 5. Order of operations

Don't ship this in one PR. Sequence:

### Phase 1 — Add new columns, dual-write (safe)
1. DB migration: add `format`, `skill_min`, `skill_max`, `self_rating`. **Do not drop old columns yet.**
2. Backfill (§3) into the new columns from existing data.
3. Application code: write to both old and new columns on create/update. Read from old (no behavior change).

### Phase 2 — Cutover reads
4. Switch all read paths to the new columns.
5. Ship the new UI (Format dropdown, dual-mode skill picker, filter changes).
6. Verify on prod for one week — no regressions in registration, match generation, standings.

### Phase 3 — Drop old columns
7. Stop writing to old columns.
8. Drop `category`, `team_type`, `skill_level` (divisions/leagues), `joinzer_level` (users), `min_skill`/`max_skill` strings (sessions).
9. Remove backward-compat code paths.

Total: roughly two weeks for a solopreneur with a real test surface. Heavier if there are downstream systems (match generation, exports) that hit the old columns — grep before you cut.

---

## 6. Risks & gotchas

- **Match generation reads format.** If your generator currently branches on `team_type === 'doubles'`, that logic ports cleanly to `isDoubles(format)`. But verify — anywhere the generator silently treats unknown enums as singles, the new enums will trip it up. Add an exhaustive `switch` with a default that *throws* in dev, log-and-fallback in prod.
- **CSV importer schema** (`email, team_name`) doesn't carry a format field — but it gates partner-pairing on the division's `format`. Import logic needs to read `divisions.format` and require/skip the partner column accordingly. Tied to the doubles-bug fixes from the earlier review.
- **Existing waitlists / registrations.** A registrant on a Mixed Doubles division with no partner today won't suddenly be valid. The fix is the partner-gate in match generation (separate finding); this migration doesn't make it worse but doesn't fix it either.
- **Mixed Doubles gender enforcement.** Today there's no gender check at registration. If you want `mixed_doubles` to actually enforce 1M/1F per team, that's new logic on the partner-invite/accept step. Optional — most rec leagues skip the enforcement.
- **"Open" in marketing copy.** Anywhere the website or emails say "Open" meaning "no skill filter," update to "All levels." Tournament name "Pro Men" stays as-is — it's a name, not a category.
- **`individual_round_robin` standings.** Doesn't use teams. The standings calculator needs a code path for individual-mode. Confirm before migrating any existing IRR league.

---

## 7. Tracking checklist

```
SCHEMA
[ ] divisions: add format, skill_min, skill_max
[ ] divisions: drop category, team_type, skill_level (Phase 3)
[ ] leagues: update format CHECK, add skill_min, skill_max, drop skill_level
[ ] users: add self_rating, drop joinzer_level
[ ] sessions: add skill_min, skill_max, drop min_skill, max_skill

BACKFILL
[ ] users.self_rating from users.joinzer_level
[ ] divisions.{format, skill_min, skill_max} from old columns
[ ] leagues.{format, skill_min, skill_max} from old columns
[ ] sessions.{skill_min, skill_max} from old strings
[ ] Audit report of coerced division rows reviewed by Marty

CODE
[ ] lib/format.ts — FORMAT_LABELS, FORMAT_HELPER, isSingles/isDoubles/requiresPartner/genderRestriction/requiresMixedPair
[ ] lib/skill.ts — SKILL_TIERS, formatSkillRange, namedTierFor, eligibility helper
[ ] components/SkillRangePicker — new shared component
[ ] Division creation: replace Category × Team Type with single Format
[ ] League creation: update Format options to canonical list
[ ] League edit: add missing fields for parity with create
[ ] Play session creation: numeric Min/Max Skill pickers
[ ] Profile edit: self_rating picker
[ ] All filter UIs use formatSkillRange + eligibility helper
[ ] Match generator: switch from team_type to isDoubles(format)
[ ] CSV importer: gate partner column on requiresPartner(division.format)

CUTOVER
[ ] Phase 1: dual-write + backfill in prod
[ ] Phase 2: read switch + new UI
[ ] Phase 3: drop old columns + cleanup
```

---

## Quick FAQ for handoff

**Q: Why numeric ratings as the source of truth, not enums?**
A: Filters are comparisons. Joins on enums require mapping tables. Numbers compose: "show me events between 3.0 and 4.0" is one expression in any layer.

**Q: Why keep named tiers at all?**
A: Most rec players think in named tiers, not numbers. Use names for input convenience, numbers for storage.

**Q: Why "All levels" instead of "Open"?**
A: "Open" already means "no gender restriction" in `open_doubles` / `open_singles`. One word, two meanings = bug factory. Pick distinct words.

**Q: Will Mixed Doubles enforce 1M/1F per team?**
A: Only if you write the check. The schema supports it (`format=mixed_doubles` + `users.gender`). The current app doesn't enforce. Decide before migration cutover; document either way.

**Q: What about DUPR integration?**
A: Already supported in the schema (`users.dupr_rating numeric`). When you ship DUPR, the filter logic uses `COALESCE(dupr_rating, self_rating)` and the display shows both. No migration impact.
