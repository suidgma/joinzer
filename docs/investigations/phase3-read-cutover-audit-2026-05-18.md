# Phase 3 Read-Cutover Audit — 2026-05-18

Scope: determine every place in the live codebase (excluding `.claude/worktrees/`) that reads
legacy columns on `leagues`, `tournament_divisions`, and `events`, and assess readiness for
Phase 3 (flip reads to new canonical columns, then drop legacy columns).

Legacy columns targeted for retirement:
- `leagues.skill_level` (string enum: beginner, beginner_plus, intermediate, intermediate_plus, advanced, advanced_plus)
- `tournament_divisions.category` (string: mixed_doubles, mens_doubles, etc.)
- `tournament_divisions.team_type` (string: singles / doubles)
- `tournament_divisions.skill_level` (Title Case string)
- `events.min_skill_level` (numeric)
- `events.max_skill_level` (numeric)

New canonical columns:
- `leagues.skill_min`, `leagues.skill_max`, `leagues.format` (already existed before Phase 1)
- `tournament_divisions.skill_min`, `tournament_divisions.skill_max`, `tournament_divisions.format`
- `events.skill_min`, `events.skill_max`

---

## 1. Read Sites (legacy column selects)

### 1.1 `leagues.skill_level`

**RS-L1** — `app/(app)/home/page.tsx` lines 76, 95
```
.select('id, name, format, skill_level, location_name, created_by')
```
Both are fetching leagues the user organizes or is registered in. `skill_level` is passed into a `League` object but this page itself only renders session info — however the fetched data is type-compatible with `CompeteClient`'s `League` type which consumes `skill_level` for display/filtering. No new canonical columns selected at these call sites.

**RS-L2** — `app/(app)/schedule/page.tsx` lines 52, 69
```
.select('id, name, format, skill_level, location_name, created_by')
```
Same structure as RS-L1; fetches user's leagues for the schedule view. No new canonical columns selected.

**RS-L3** — `app/(app)/compete/page.tsx` line 26
```
.select('id, name, format, skill_level, location_name, start_date, end_date, max_players, registration_status, creator:profiles!created_by (name)')
```
Feeds `CompeteClient` for the Compete listing page. `skill_level` is read and passed as a prop. No new canonical columns selected.

**RS-L4** — `app/api/leagues/[id]/members/route.ts` line 68
```
.select('name, format, skill_level, location_name')
```
Inside `notifyPlayerAdded()` — used to render `skill_level` as a plain string in a registration confirmation email. No new canonical columns selected.

**RS-L5** — `app/api/league-register/route.ts` line 49
```
.select('name, format, skill_level, location_name, start_date, end_date, max_players, registration_status, registration_closes_at, cost_cents, schedule_description')
```
Reads `skill_level` for use in registration email. No new canonical columns selected.

**RS-L6** — `app/(app)/compete/leagues/[id]/edit/page.tsx` line 103
```
.select('*')
```
Wildcard select — fetches all columns including `skill_level`. Used to populate the Edit League form. No targeted column exclusions.

**RS-L7** — `app/(app)/compete/leagues/[id]/page.tsx` line 38 (indirect)
```
.select('*, cost_cents, organization:organizations(name), creator:profiles!created_by (name)')
```
Wildcard — fetches all columns. The page passes `leagueSkillLevel` prop derived from `league.skill_level` to `PlayerCheckIn` component for sub request payload. No explicit new canonical column read (covered implicitly by `*`).

No reads of `skill_min`, `skill_max` appear in any `.select()` call on `leagues` in live code.

---

### 1.2 `tournament_divisions.category`, `.team_type`, `.skill_level`

**RS-D1** — `app/(app)/tournaments/[id]/page.tsx` line 70
```
.select('id, name, category, skill_level, team_type, max_entries, waitlist_enabled, status, bracket_type, format_settings_json, cost_cents')
```
Feeds both `DivisionsSection` and `MatchesSection`/`ScheduleManager`/`MyMatchesSection`. All three legacy columns selected; no `skill_min`, `skill_max`, or `format` selected.

**RS-D2** — `app/api/tournaments/[id]/divisions/[divisionId]/register/route.ts` line 42
```
.select('id, tournament_id, team_type, max_entries, waitlist_enabled, status, name')
```
Reads `team_type` to enforce solo-only-for-doubles logic. No new canonical columns selected.

All other `tournament_divisions` reads in live code select only `id` and `name` (for email copy or refund routes) — no legacy taxonomy columns involved.

---

### 1.3 `events.min_skill_level`, `events.max_skill_level`

**RS-E1** — `app/(app)/events/[id]/page.tsx` lines 64–75
```
.select(`id, title, ..., min_skill_level, max_skill_level, ...`)
```
Renders skill range on the event detail page. No `skill_min` / `skill_max` in select.

**RS-E2** — `app/(app)/events/page.tsx` lines 47–53
```
.select(`id, title, ..., min_skill_level, max_skill_level, ...`)
```
Used for the JS post-filter on lines 84–88 (`ev.min_skill_level`, `ev.max_skill_level`). No `skill_min` / `skill_max` in select.

**RS-E3** — `app/(app)/events/create/page.tsx` lines 37–38
```
.select('title, location_id, starts_at, duration_minutes, court_count, players_per_court, min_skill_level, max_skill_level, notes, session_type, price_cents')
```
Reads `min_skill_level` / `max_skill_level` from a template event to pre-fill the create form (the `?from=` query param flow). Values assigned to `defaults.minSkill` / `maxSkill` on lines 58–59. No `skill_min` / `skill_max` in select.

**RS-E4** — `lib/types.ts` lines 28–29
```typescript
min_skill_level: number | null
max_skill_level: number | null
```
`EventListItem` and `EventDetail` TypeScript types declare the legacy columns. `skill_min` / `skill_max` not declared in either type.

**RS-E5** — `app/(app)/events/[id]/edit/page.tsx` line 14 (no skill columns)
The edit page select does NOT include `min_skill_level` / `max_skill_level` — the edit form (`EditEventForm`) also does not have skill fields. This is a gap: the edit form cannot currently update skill range at all.

---

### 1.4 RPC calls

**RPC-1** — `components/features/events/AssignCaptainButton.tsx` line 38: `rpc('assign_captain', ...)`
**RPC-2** — `app/api/events/[id]/leave/route.ts` line 28: `rpc('leave_event', ...)`
**RPC-3** — `components/features/events/JoinLeaveButton.tsx` line 41: `rpc('join_event', ...)`
**RPC-4** — `app/api/stripe/webhook/route.ts` line 68 and `app/api/tournaments/[id]/checkout/route.ts` line 138: `rpc('increment_discount_uses', ...)`

None of these RPCs reference the legacy taxonomy columns (confirmed by DB function body inspection in Section 3).

---

## 2. Render Sites (legacy value usage)

### 2.1 `leagues.skill_level` values in render logic

**RD-L1** — `app/(app)/compete/CompeteClient.tsx` lines 18–24, 82–86, 138
```typescript
const SKILL_LEVEL_TO_TIER: Record<string, SkillTier> = {
  beginner: 'Beginner', beginner_plus: 'Beginner Plus',
  intermediate: 'Intermediate', intermediate_plus: 'Intermediate Plus',
  advanced: 'Advanced',
}
// ...
const tier = SKILL_LEVEL_TO_TIER[l.skill_level]
return tier ? activeFilters.has(tier) : false
// ...
const tier = SKILL_LEVEL_TO_TIER[league.skill_level] ?? league.skill_level
```
This is a **logic** site. `skill_level` drives a filter branch on line 84: leagues not matching the active tier set are hidden. The display label at line 138 is display-only, but the filter at line 84 is a conditional. Both depend on the string enum keys.

**RD-L2** — `app/(app)/compete/leagues/[id]/page.tsx` line 151
```typescript
const DOUBLES_FORMATS = ['mens_doubles', 'womens_doubles', 'mixed_doubles', 'coed_doubles']
const isDoublesLeague = DOUBLES_FORMATS.includes(league.format)
```
This is a `format` read, not `skill_level`. Not a legacy-column read site. Included here because it will need to remain valid after cutover (and it will, since `format` is a new canonical column already correctly set).

**RD-L3** — `app/(app)/compete/leagues/[id]/page.tsx` (indirect via PlayerCheckIn component) — line 67 in `PlayerCheckIn.tsx`
```typescript
body: JSON.stringify({ requested_skill_level: leagueSkillLevel ?? null })
```
`leagueSkillLevel` is `league.skill_level` passed from the parent page. This posts the legacy string value to `/api/league-sub-requests`. **Logic** site — the string is persisted as a sub request field.

**RD-L4** — `app/(app)/compete/leagues/[id]/page.tsx` lines 22–28
```typescript
const SKILL_LABELS: Record<string, string> = {
  beginner: 'Beginner', beginner_plus: 'Beginner+', ...
}
```
Used in the league detail page to display skill level. **Display-only** badge.

**RD-L5** — `app/(app)/compete/leagues/[id]/edit/page.tsx` lines 110, 214–216
```typescript
setSkillLevel(data.skill_level ?? 'intermediate')
// ...
<select value={skillLevel} onChange={...}>
  {SKILL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
</select>
```
Form populates from `skill_level`; writes back via `prepareLeagueWrite({ format, skill_level: skillLevel })` which dual-writes to both old and new columns. **Form input** site.

**RD-L6** — `app/(app)/compete/leagues/create/CreateLeagueForm.tsx` lines 20–26, 46
```typescript
const SKILL_OPTIONS = [{ value: 'beginner', ... }, ...]
const [skillLevel, setSkillLevel] = useState('intermediate')
```
Form uses string enum as the controlled value. Writes via `prepareLeagueWrite`. **Form input** site.

**RD-L7** — `app/api/leagues/[id]/members/route.ts` lines 105, 76–83
```typescript
FORMAT_LABELS: Record<string, string> = { ... }
league.skill_level ? `<td>...${league.skill_level}...</td>` : ''
```
Renders `skill_level` directly (no label map) in registration email HTML. **Display-only** (email).

**RD-L8** — `app/api/league-register/route.ts` (indirect) — reads `skill_level` from league for email rendering via `registrationEmail` template helper.

---

### 2.2 `tournament_divisions.category` / `team_type` / `skill_level` in render logic

**RD-D1** — `components/features/tournaments/DivisionsSection.tsx` lines 16–22, 758–761, 1154
```typescript
const CATEGORY_LABELS: Record<string, string> = {
  mens_doubles: 'Men', womens_doubles: 'Women', mixed_doubles: 'Mixed',
  singles: 'Singles', open: 'Open',
}
// ...
{CATEGORY_LABELS[div.category] ?? div.category}
{div.team_type === 'doubles' ? 'Doubles' : 'Singles'}
{div.skill_level && ` · ${div.skill_level}`}
```
`category` and `skill_level` are **display-only** labels. `team_type` at line 258 is **logic**: `if (div.team_type === 'doubles' && regType === 'team')` controls whether partner invite step shows. Also at lines 822–825: `div.team_type === 'doubles' ? effectiveTeams : active.length` and team/player count label. Also at lines 1028–1031 in organizer panel.

**RD-D2** — `components/features/tournaments/DivisionsSection.tsx` line 384/1097
```typescript
searchPlayers(query, excludeUserIds, div.category)
// called also from the "Add Player" button onclick
if (category === 'mens_doubles') q = q.eq('gender', 'male')
else if (category === 'womens_doubles') q = q.eq('gender', 'female')
```
`div.category` is passed to `searchPlayers` which uses it to filter by gender in player search. **Logic** site — adding a player to a mens/womens division filters the search results.

**RD-D3** — `app/(app)/compete/tournaments/create/CreateTournamentForm.tsx` lines 8–14, 96, 100
```typescript
const CATEGORY_OPTIONS = [{ value: 'mens_singles', ... }, ...]
// ...
category: ev.category,
skill_level: ev.skill_level.trim() || null,
```
Form draft uses `category` and `skill_level` as the controlled values and writes them directly to `tournament_events` (note: this form creates `tournament_events`, not `tournament_divisions`). **Form input** site, but targets `tournament_events` table, not `tournament_divisions`.

**RD-D4** — `app/(app)/compete/tournaments/[id]/TournamentEventList.tsx` lines 9–20, 32–39
```typescript
type EventItem = { ..., category: string, skill_level: string | null, ... }
function skillMismatchWarning(skillLevel: string | null, userRating: number | null): string | null {
  const eventRating = parseFloat(skillLevel)
  ...
}
```
Reads `skill_level` from `tournament_events` (the old tournament domain, not `tournament_divisions`). `skillMismatchWarning` drives a logic branch (warning display). This is the old `tournament_events` table, not `tournament_divisions` — **outside Phase 3 scope**.

**RD-D5** — `app/(app)/compete/tournaments/[id]/roster/TournamentRosterManager.tsx` lines 32–38
```typescript
const CATEGORY_LABELS: Record<string, string> = { ... }
// type EventRow = { ..., category: string, skill_level: string | null, ... }
```
`category` used for label display only in roster. **Display-only**.

**RD-D6** — `components/features/tournaments/MatchesSection.tsx` lines 38–40
```typescript
type Division = { ..., team_type: string, ... }
const isDoubles = divisions.find(d => d.id === m.division_id)?.team_type === 'doubles'
```
`team_type === 'doubles'` controls whether doubles name format (LastName/LastName) is used in match rendering. **Logic** site.

**RD-D7** — `components/features/tournaments/ScheduleManager.tsx` lines 30–33
```typescript
type Division = { ..., team_type: string, ... }
```
`team_type` used to determine doubles vs. singles name display in schedule. **Logic** site.

**RD-D8** — `components/features/tournaments/MyMatchesSection.tsx` lines 40–42
```typescript
type Division = { ..., team_type: string, ... }
const isDoubles = divisions.find(d => d.id === m.division_id)?.team_type === 'doubles'
```
Same `team_type` → doubles name format logic. **Logic** site.

**RD-D9** — `app/api/tournaments/[id]/divisions/[divisionId]/register/route.ts` line 52
```typescript
if (registration_type === 'solo' && division.team_type !== 'doubles') {
  return NextResponse.json({ error: 'Solo registration is only available for doubles divisions' }, { status: 400 })
}
```
`team_type` drives a registration gate. **Logic** site — wrong value causes incorrect allow/block on solo registration.

---

### 2.3 `events.min_skill_level` / `max_skill_level` in render logic

**RD-E1** — `components/features/events/EventCard.tsx` lines 45–54, 95–104
```typescript
{(event.min_skill_level != null || event.max_skill_level != null) && (
  <p>Skill: {event.min_skill_level?.toFixed(1)} – {event.max_skill_level?.toFixed(1)}</p>
)}
```
**Display-only** badge. Renders the numeric range as a string.

**RD-E2** — `app/(app)/events/page.tsx` lines 82–88
```typescript
events = events.filter((ev) => {
  const minOk = ev.min_skill_level == null || ev.min_skill_level <= skillFilter
  const maxOk = ev.max_skill_level == null || ev.max_skill_level >= skillFilter
  return minOk && maxOk
})
```
**Logic** site. Post-query JS filter — the numeric comparison directly gates which events a player can see.

**RD-E3** — `app/(app)/events/create/page.tsx` lines 58–59
```typescript
minSkill: src.min_skill_level != null ? String(src.min_skill_level) : '',
maxSkill: src.max_skill_level != null ? String(src.max_skill_level) : '',
```
**Form input** — pre-fills new event form from a template event. Written back via `prepareEventWrite` which dual-writes both columns.

**RD-E4** — `lib/types.ts` lines 28–29, 80–81
`EventListItem.min_skill_level`, `EventListItem.max_skill_level`, `EventDetail.min_skill_level`, `EventDetail.max_skill_level` — TypeScript type declarations. Must be updated or extended with new column names on cutover.

---

## 3. RLS Policies and DB Functions

### 3.1 RLS Policies

Query A results — no RLS policy on any of the three tables references any legacy taxonomy column. All policies use `auth.uid()` comparisons against owner/creator columns only.

| Table | Policy | USING expr | WITH CHECK |
|---|---|---|---|
| events | events: authenticated users can read events | `true` | — |
| events | events: only captain can update | `captain_user_id = auth.uid()` | same |
| events | events: authenticated users can create | — | `creator_user_id = auth.uid() AND captain_user_id = auth.uid()` |
| events | events: only captain can delete | `captain_user_id = auth.uid()` | — |
| leagues | league_select | `true` | — |
| leagues | league_insert | — | `created_by = auth.uid()` |
| leagues | league_update | `created_by = auth.uid()` | — |
| tournament_divisions | divisions_read | `true` | — |
| tournament_divisions | divisions_organizer_insert/update/delete | EXISTS check against tournaments.organizer_id | — |

**Finding:** No RLS policies reference legacy taxonomy columns. Phase 3 can drop columns without touching any policy.

### 3.2 DB Functions

All five public functions were inspected:

- `assign_captain` — references `events` table only by `id` / `captain_user_id`. No taxonomy columns.
- `join_event` — references `events` by `id`, `status`, `max_players`, `price_cents`, `registration_closes_at`. No taxonomy columns.
- `leave_event` — references `events` by `id`, `status`, `captain_user_id`. No taxonomy columns.
- `increment_discount_uses` — references `tournament_discount_codes`. No taxonomy columns.
- `update_updated_at_column` — generic trigger. No taxonomy columns.

**Finding:** Zero DB functions reference legacy taxonomy columns. Phase 3 can drop columns without touching any function.

### 3.3 DB Views

Query C returned zero rows. No public views reference legacy taxonomy columns.

---

## 4. Read Site Categorization

| ID | File (line) | Legacy columns read | Category | Reason |
|---|---|---|---|---|
| RS-L1 | `app/(app)/home/page.tsx` (76, 95) | `skill_level` | Display-only | Fetched as part of `League` object; rendered via `SKILL_LEVEL_TO_TIER` map downstream in CompeteClient — but home page itself only uses league id/name for session linking, not skill_level. However, same select shape is used for CompeteClient, making this Display-only in isolation. |
| RS-L2 | `app/(app)/schedule/page.tsx` (52, 69) | `skill_level` | Display-only | Same League object fetched for schedule rendering; no filtering on skill_level in this page. |
| RS-L3 | `app/(app)/compete/page.tsx` (26) | `skill_level` | Logic | Fed into `CompeteClient` which uses `skill_level` for filter. Cutover requires swapping the column in the select AND updating CompeteClient's filter logic. |
| RS-L4 | `app/api/leagues/[id]/members/route.ts` (68) | `skill_level` | Display-only | Rendered as plain string in email HTML. |
| RS-L5 | `app/api/league-register/route.ts` (49) | `skill_level` | Display-only | Used in registration email rendering. |
| RS-L6 | `app/(app)/compete/leagues/[id]/edit/page.tsx` (103) | `skill_level` (via `*`) | Form input | `data.skill_level` populates the skill level dropdown and is submitted back via `prepareLeagueWrite`. |
| RS-L7 | `app/(app)/compete/leagues/[id]/page.tsx` (38) | `skill_level` (via `*`) | Logic | `league.skill_level` passed to `PlayerCheckIn` as `leagueSkillLevel` which posts it to the sub-request API. |
| RS-D1 | `app/(app)/tournaments/[id]/page.tsx` (70) | `category`, `skill_level`, `team_type` | Logic | All three columns feed DivisionsSection, MatchesSection, ScheduleManager, MyMatchesSection — each of which contains logic branches on `team_type`. |
| RS-D2 | `app/api/tournaments/[id]/divisions/[divisionId]/register/route.ts` (42) | `team_type` | Logic | `team_type !== 'doubles'` gates solo registration. |
| RS-E1 | `app/(app)/events/[id]/page.tsx` (67) | `min_skill_level`, `max_skill_level` | Display-only | Renders numeric range on event detail page. |
| RS-E2 | `app/(app)/events/page.tsx` (49) | `min_skill_level`, `max_skill_level` | Logic | JS post-filter compares against user's skill filter — directly controls visible events list. |
| RS-E3 | `app/(app)/events/create/page.tsx` (37) | `min_skill_level`, `max_skill_level` | Form input | Pre-fills create form from template event. |
| RD-L1 | `app/(app)/compete/CompeteClient.tsx` (18–86) | `skill_level` | Logic | Filter branch hides leagues not matching active tier. |
| RD-L3 | `components/features/leagues/PlayerCheckIn.tsx` (67) | `skill_level` (via prop) | Logic | Posts legacy string to sub-request API; value stored in `league_sub_requests.requested_skill_level`. |
| RD-D1 | `components/features/tournaments/DivisionsSection.tsx` (258, 822, 1028) | `team_type`, `category`, `skill_level` | Logic (team_type) / Display-only (category, skill_level) | `team_type` drives partner-invite step, count display, partner badge. `category`/`skill_level` are label-only. |
| RD-D2 | `components/features/tournaments/DivisionsSection.tsx` (384, 1097) | `category` | Logic | `category` drives gender filter for player search (`mens_doubles` → filter male). |
| RD-D6 | `components/features/tournaments/MatchesSection.tsx` (110) | `team_type` | Logic | Doubles name format in match row. |
| RD-D7 | `components/features/tournaments/ScheduleManager.tsx` (32) | `team_type` | Logic | Doubles name format in schedule row. |
| RD-D8 | `components/features/tournaments/MyMatchesSection.tsx` (110) | `team_type` | Logic | Doubles name format in my-matches row. |
| RD-D9 | `app/api/tournaments/[id]/divisions/[divisionId]/register/route.ts` (52) | `team_type` | Logic | Gates solo registration per division. |
| RD-E1 | `components/features/events/EventCard.tsx` (45, 95) | `min_skill_level`, `max_skill_level` | Display-only | Skill range badge in card. |
| RD-E2 | `app/(app)/events/page.tsx` (84–88) | `min_skill_level`, `max_skill_level` | Logic | JS filter controls which events are visible to the player. |
| RD-E3 | `app/(app)/events/create/page.tsx` (58–59) | `min_skill_level`, `max_skill_level` | Form input | Pre-fills skill defaults on new event from template. |
| RD-E4 | `lib/types.ts` (28–29, 80–81) | `min_skill_level`, `max_skill_level` | Display-only | TypeScript type declarations; must be updated. |

---

## 5. Null Coverage on New Columns

### leagues (10 total rows)

| Column | Non-null | Null | Status |
|---|---|---|---|
| `skill_min` | 10 | 0 | COMPLETE |
| `skill_max` | 10 | 0 | COMPLETE |
| `format` | 10 | 0 | COMPLETE |

**All 10 leagues are fully backfilled. Phase 3 is safe to proceed for leagues.**

### tournament_divisions (29 total rows)

| Column | Non-null | Null | Status |
|---|---|---|---|
| `skill_min` | 11 | 18 | INCOMPLETE |
| `skill_max` | 11 | 18 | INCOMPLETE |
| `format` | 25 | 4 | INCOMPLETE |

**18 of 29 rows have NULL `skill_min`/`skill_max`. 4 of 29 have NULL `format`.**

Detailed null breakdown (18 rows with null skill_min/skill_max):
- All 18 also have `skill_level = NULL` in the legacy column.
- This means the Phase 1 backfill correctly mapped NULL legacy → NULL new (no loss), but 18 rows genuinely have no skill data at all.
- Dropping `skill_level` is safe for these rows since there's nothing to preserve.
- The 4 rows with NULL `format` include two test/malformed rows (`single`, `double`, `women`, `ababe148...`) created before Phase 1 or with mismatched `category`/`team_type` that the backfill couldn't map.
- **Phase 3 cannot drop `format` from `tournament_divisions` until those 4 rows are backfilled or confirmed as test data to be deleted.**

Specific rows with NULL `format` (IDs):
- `46985294` — name "single", category=mixed_doubles, team_type=singles
- `d4330f4c` — name "Open", category=open, team_type=singles
- `6c69c827` — name "double", category=mixed_doubles, team_type=doubles
- `ababe148` — name "Women", category=womens_doubles, team_type=singles

All four appear to be test/dev data (single-word names, no skill data). Confirm and delete or backfill before dropping.

### events (20 total rows)

| Column | Non-null | Null | Status |
|---|---|---|---|
| `skill_min` | 10 | 10 | INCOMPLETE |
| `skill_max` | 3 | 17 | SEVERELY INCOMPLETE |

**Critical gap:** `skill_max` is non-null in only 3 of 20 rows. Detailed breakdown:
- 7 rows have `skill_min` non-null but `skill_max` NULL — these have a legacy `min_skill_level` value but `max_skill_level = NULL` (confirmed in null detail query: e.g., `min_skill_level = 3.0, max_skill_level = null, skill_min = 3.0, skill_max = null`).
- 10 rows have both `skill_min` and `skill_max` NULL and also have no legacy values.
- The Phase 2 dual-write correctly mirrors: `skill_max = max_skill_level`, so the NULLs in `skill_max` accurately reflect that these events never had a `max_skill_level` set.

This is not a backfill failure — it reflects organizers who set only `min_skill_level`. Dropping `max_skill_level` is safe since `skill_max` faithfully preserves the same NULL for those rows. **However, the EventCard and events page list currently read `min_skill_level` / `max_skill_level` — switching reads to `skill_min` / `skill_max` will produce identical rendered output, so cutover is safe as long as `skill_min` / `skill_max` are also selected.**

**Phase 3 is safe to proceed for events once the select strings are updated.**

---

## 6. Risk Notes

### Logic and Form Input sites — what breaks on incorrect cutover

**RS-L3 / RD-L1 (CompeteClient league filter):**
If `skill_level` is dropped before `CompeteClient` is updated to read `skill_min`/`skill_max`, all leagues return no tier match and the filter shows nothing when active. The display label also breaks. Cutover requires: (1) add `skill_min`/`skill_max` to the `.select()` in `compete/page.tsx`, (2) replace `SKILL_LEVEL_TO_TIER` logic with a range-to-tier reverse lookup, and (3) update the `League` TypeScript type.

**RS-L7 / RD-L3 (PlayerCheckIn sub-request `requested_skill_level`):**
If `skill_level` is dropped before `league_sub_requests.requested_skill_level` write path is updated, sub requests will post `null` as the skill level, losing organizer context. This is a write path that uses a read value — the sub request still succeeds, but skill context is lost silently.

**RS-D1 / RD-D6/D7/D8 (`team_type` in tournament match rendering):**
`DivisionsSection`, `MatchesSection`, `ScheduleManager`, and `MyMatchesSection` all use `team_type === 'doubles'` to choose between "LastName / LastName" and single-player name formats. If `team_type` is dropped before these components are updated to derive doubles-ness from the new `format` column, all match names will render as singles format regardless of division type.

**RS-D2 / RD-D9 (`team_type` in registration API):**
`app/api/tournaments/[id]/divisions/[divisionId]/register/route.ts` line 52 gates solo registration on `division.team_type !== 'doubles'`. Dropping `team_type` before updating this check will block all solo registrations (or allow them for all divisions) depending on how the NULL is handled.

**RD-D2 (`category` in player search gender filter):**
`DivisionsSection` passes `div.category` to `searchPlayers` to filter by gender. Dropping `category` before replacing this with a format-based check (e.g., `format === 'mens_doubles'` → male) will cause gender filter to silently stop working — organizers will see all genders when adding to a Men's division.

**RS-E2 / RD-E2 (events page JS skill filter):**
If `min_skill_level` / `max_skill_level` are dropped before the events page is updated to read `skill_min` / `skill_max`, the post-query filter on lines 84–88 will compare `undefined <= skillFilter`, which evaluates as `false`, and the condition `ev.min_skill_level == null` will be `true` (since the property is absent). Result: all events pass the filter regardless of skill, showing incorrect results to players who've set a skill filter.

**RS-E3 / RD-E3 (create event from template):**
If `min_skill_level` / `max_skill_level` are dropped before the create page is updated, the "copy event" flow (`?from=`) will pre-fill blank skill fields even when the source event had a skill range, silently losing that data in duplicated events.

**RD-L6 / RS-L6 (Edit League form):**
If `skill_level` is dropped before the edit form is updated, the form will fail to populate the skill dropdown (defaulting to 'intermediate'), and any save will write `prepareLeagueWrite({ skill_level: 'intermediate', ... })` regardless of actual league skill level — silently overwriting skill data for all league edits.

---

## 7. Phase 3 Split Recommendation

**Recommendation: three tickets.**

**Ticket 3A — events table (lowest risk, isolated)**
Swap `min_skill_level` / `max_skill_level` to `skill_min` / `skill_max` across `EventListItem` and `EventDetail` types, the events page select and JS filter, the event detail page select, the create-from-template select and default wiring, and `EventCard` rendering. No logic shape change — the columns are both numeric and the semantics are identical. This can be done and deployed in a single PR with zero risk of the filter accidentally breaking because the new and old values are identical. Drop legacy columns after deploy and verification.

**Ticket 3B — leagues table (medium complexity, string→numeric shape change)**
Swap `skill_level` reads in `compete/page.tsx`, `home/page.tsx`, `schedule/page.tsx`, `league-register/route.ts`, `members/route.ts`, `edit/page.tsx`, `league/[id]/page.tsx`, and `PlayerCheckIn`. The key complexity is `CompeteClient`: the current filter is a string enum lookup (`SKILL_LEVEL_TO_TIER`); Phase 3 must replace this with a numeric range comparison or a reverse-range-to-tier lookup. The edit form must also change from a string enum `<select>` to either a numeric range picker or a skill label picker backed by new column values. The `league_sub_requests.requested_skill_level` write path should be reviewed separately — it currently stores the legacy string; after cutover it should store a numeric range or be dropped from sub requests entirely. Drop `skill_level` after all reads and the sub-request write path are updated.

**Ticket 3C — tournament_divisions table (highest complexity, three columns, multiple logic branches)**
`team_type` is the most widely used — it drives match name rendering in three components and the solo-registration gate in the API. Before dropping, all `team_type === 'doubles'` checks must be replaced with a `format`-based equivalent (e.g., `['mens_doubles','womens_doubles','mixed_doubles','coed_doubles'].includes(format)`). `category` drives the gender filter in player search — replace with format-based check. `skill_level` on divisions is display-only (unlike leagues) and is the simplest to cut. Also requires backfilling or deleting the 4 rows with NULL `format` and confirming the 18 rows with NULL `skill_min`/`skill_max` are intentional (they are — those divisions have no skill constraint). This ticket should not begin until Ticket 3A and 3B are deployed and verified, since the divisions component complexity warrants a focused PR.

**Justification:** Separating by table decouples risk — an events regression cannot block a leagues deploy. The leagues cutover involves a non-trivial form shape change (string enum → numeric range) that deserves its own review cycle. The tournament_divisions cutover touches the most logic branches and has the 4-row NULL-format prerequisite, making it the highest-risk ticket that benefits most from being isolated.
