# Team League

> Source-of-truth design + build plan for the **Team League** format. Design/planning
> only — nothing here is implemented yet. Companion to `docs/phases/league-formats.md`
> (§11 "Future Team League — architecture fit check", which this supersedes) and
> `docs/architecture-target.md` (the aspirational `competition_teams` model).
> If code and this doc ever disagree, the code wins — flag it and update this file.
>
> Status: **planned** (not built). Last revised: July 8, 2026.

---

## 1. Overview

**Team League** is a roster-based, captain-managed league format:

- **Teams have multiple players** (a roster, with a captain).
- Teams compete in **scheduled team matchups** (typically one per week).
- Each **team matchup is composed of several individual line matches** (e.g. Line 1
  doubles, Line 2 doubles, Line 3 mixed…).
- **Individual line results determine the matchup winner** (most lines won).
- **Team standings** update through the season from matchup results.

Framing that keeps the architecture small:

- **Fixed doubles-team leagues are just a Team League with one line.** Not a separate format.
- **MLP-style leagues are a preset, not a separate architecture** — a specific set of
  lines (WD / MD / MX1 / MX2 + a tiebreaker), configured on the same model.
- **Draft leagues are a future team-*formation* feature** layered on the same team model,
  not a different league type.

There is **one format** (`format_kind = 'team'`); everything else is configuration.

---

## 2. Architecture principles

### Principle 1 — Reuse existing architecture; do not fork it.

Team League must **not** introduce a:

- separate **team scheduling** engine → reuse `roundRobinMatches()` / the schedule primitives,
- separate **standings** system → reuse the standings tiebreak core,
- separate **scoring** system → reuse the `league_fixtures` score flow,
- separate **playoff** system → reuse the tournament bracket engine (later).

Where an existing function hard-codes registration IDs, **generalize it once** (accept an
entity-id accessor) rather than copying it.

### Principle 2 — Use the existing fixture model (parent → child).

```
League (format_kind='team')
└─ League Teams              (league_teams)
   └─ Team Members           (league_team_members)
└─ Matchday Period           (league_periods, period_kind='matchday')
   └─ Parent Fixture         (league_fixtures, match_stage='team_matchup')  = Team A vs Team B
      └─ Child Fixtures       (league_fixtures, match_stage='team_line', parent_fixture_id → parent)
```

Example matchup — **Dink Dynasty vs Kitchen Crushers**:

| Fixture | Kind | Sides |
|---|---|---|
| Parent | `team_matchup` | Dink Dynasty (team) vs Kitchen Crushers (team) |
| Child — Line 1 | `team_line`, doubles | Dynasty {A,B} vs Crushers {P,Q} |
| Child — Line 2 | `team_line`, doubles | Dynasty {C,D} vs Crushers {R,S} |
| Child — Line 3 | `team_line`, mixed | Dynasty {A,E} vs Crushers {P,T} |
| Child — Line 4 | `team_line`, mixed | Dynasty {C,F} vs Crushers {R,U} |

The parent carries the **team-vs-team** result (`team_1_id`, `team_2_id`, `winner_team_id`,
matchup score like 3–1). The children carry the **playable** individual matches.

### Principle 3 — Preserve individual player results.

**Every line is a real child fixture** — we do **not** only store a team score like 3–1.
Storing the individual matches means:

- **Player match history** works (each player's games are recorded fixtures).
- **Joinzer rating integration works for free** — the rating engine already reads
  `league_fixtures` (`lib/rating/extract.ts`); child line fixtures carry real player
  registrations + scores, so team-league play improves players' Joinzer Scores with no
  extra work. (Parent `team_matchup` fixtures have `team_*_id` but **no**
  `team_*_registration_id`, so the extractor naturally skips them — ratings stay clean.)
- **Score auditing works** — reuse `logAudit()` per child fixture.
- **Statistics remain meaningful** at the player level, not just the team level.

---

## 3. Reuse map

| System | Reuse decision | Where |
|---|---|---|
| `league_fixtures` | **Reuse** for both the parent matchup and the child lines | `20260702000005_league_fixtures.sql` |
| `parent_fixture_id` | **Reuse** — the intended child→parent link (currently unused) | same |
| `league_periods` (`matchday`) | **Reuse** — one row per week | `20260702000006` |
| `roundRobinMatches()` | **Reuse as-is** — generic on `string[]` entrant IDs; handles byes (odd team counts) | `lib/tournament/bracketBuilder.ts` |
| `poolPlayMatches()` | Reuse later (divisions/pools) | same |
| Scheduling utilities (`orderByDependency`, schedule blocks) | **Reuse** ordering/block schema; the within-block scheduler needs an entity accessor (later) | `lib/tournament/scheduleGenerator.ts`, `schedule/` |
| Fixture scoring flow | **Reuse the pattern** (score → winner → status → audit) for child lines | `.../leagues/[id]/fixtures/[fixtureId]/score/route.ts` |
| Standings engine (tiebreak: win% → diff → H2H → PF → name) | **Reuse** — generalize the core to key on team IDs | `lib/leagues/fixtureStandings.ts`, `lib/tournament/standings.ts` |
| Playoff / bracket engine | **Reuse later** — entrant-generic; seed team IDs; `team_*_source` placeholders | `bracketBuilder.ts`, `resolveCompletion.ts`, `poolPlayoffSeeding.ts` |
| Audit logging | **Reuse** — add `league_team` / `league_team_member` entity types | `lib/audit/log.ts` |
| Notifications | **Reuse** — add team-scoped kinds | `lib/notifications/create.ts` |
| Payments | **Reuse** the per-player checkout + doubles auth-hold pattern | `.../leagues/[id]/checkout/route.ts` |
| Registrations | **Reuse** — players still register individually (`league_registrations`); teams *group* them | verified schema |
| Attendance / subs | **Reuse** `AttendanceGrid` + `buildAttendeeRows` + `league_attendance` | `components/features/leagues/AttendanceGrid.tsx` |
| Roles / PII gate | **Reuse** `is_captain_of()` RPC (extend to team captains) | `captain_check_fn.sql` |
| Format dispatch pattern | **Reuse** the `format_kind` branch pattern | `runSession.ts`, `{page,standings,roster}` |

### Must NOT be duplicated

- **The bracket engine** — never fork `bracketBuilder.ts` for teams; pass team IDs.
- **The standings tiebreak logic** — generalize the one core; do not copy it.
- **The scheduler** — do not build a second scheduling engine.
- **A parallel `team_matchups` table** — the parent `league_fixture` *is* the matchup;
  a separate table would re-implement scheduling/status/scoring columns. (Revisit only if
  future investigation proves the fixture model can't carry a matchup — not expected.)

---

## 4. Data model plan

### New tables

**`league_teams`** — the team entity.
```
id                     uuid pk
league_id              uuid fk leagues
name                   text not null
captain_registration_id uuid fk league_registrations   -- nullable
seed                   integer                          -- nullable (for future playoffs)
status                 text  'active' | 'withdrawn'      default 'active'
created_by             uuid
created_at, updated_at timestamptz
unique (league_id, name)
```

**`league_team_members`** — the roster.
```
id              uuid pk
team_id         uuid fk league_teams on delete cascade
registration_id uuid fk league_registrations
role            text  'captain' | 'co_captain' | 'member' | 'sub'   default 'member'
created_at      timestamptz
unique (team_id, registration_id)
```

### Additions to `league_fixtures` (all nullable → additive, zero impact on other formats)

```
team_1_id                      uuid fk league_teams   -- PARENT matchup: team A
team_2_id                      uuid fk league_teams   -- PARENT matchup: team B
winner_team_id                 uuid fk league_teams   -- PARENT matchup: result
team_1_partner_registration_id uuid fk league_registrations  -- CHILD doubles line: 2nd player, side A
team_2_partner_registration_id uuid fk league_registrations  -- CHILD doubles line: 2nd player, side B
```

Reasoning:
- **Parent fixtures represent team matchups** → they need to point at two *teams*
  (`team_1_id` / `team_2_id`), which the existing `team_*_registration_id` columns (FK
  players) cannot hold. Hence three new team-FK columns on the parent.
- **Child fixtures represent playable matches** → they use the existing
  `team_*_registration_id` for the players on each side. **Doubles lines need two players
  per side chosen *ad hoc* each week** (not a season-long fixed pair), so we add
  `team_*_partner_registration_id` — exactly mirroring how `tournament_matches` already
  represents rotating-doubles (4 distinct registrations, 2 per side). This keeps
  Principle 3 (real per-player fixtures) intact and makes rating extraction work.
- **No `team_matchups` table** — see §3.

`match_stage` (free-text on `league_fixtures`): `'team_matchup'` for parents,
`'team_line'` for children. Playoffs later reuse the tournament stages
(`'winners_bracket'`, etc.).

### Indexes

`league_fixtures (team_1_id)`, `(team_2_id)`, `(parent_fixture_id)` (parent index already
exists), `league_team_members (team_id)`, `(registration_id)`,
`league_teams (league_id)`.

### RLS

`league_teams`, `league_team_members`: **enable RLS, no policies (deny-all)** — server
writes/reads via the service role, mirroring `league_boxes` / `league_fixtures`. The new
`league_fixtures` columns inherit the table's existing deny-all RLS.

### Config (`leagues.format_settings_json` for `format_kind='team'`)

```jsonc
{
  "roster_min": 4,
  "roster_max": 10,               // soft cap
  "allow_multi_line": true,       // may a player appear on >1 line
  "matchup_win_rule": "most_lines",
  "tiebreak": "point_diff",       // MVP: point diff on a 2–2 tie; MLP adds a tiebreak line
  "roster_lock": "matchday_start",
  "lines": [
    { "key": "l1", "label": "Line 1", "discipline": "doubles", "gender": "open", "games_to": 11, "win_by": 2 },
    { "key": "l2", "label": "Line 2", "discipline": "doubles", "gender": "open", "games_to": 11, "win_by": 2 },
    { "key": "l3", "label": "Line 3", "discipline": "doubles", "gender": "open", "games_to": 11, "win_by": 2 }
  ]
}
```

`leagues.format` for a team league = `'custom'` (the per-line disciplines live in `lines`).

---

## 5. MVP definition (Phase 1)

**Included:**
- Create a Team League (format option + team settings + line config, "Simple" preset).
- Create teams; assign a captain; manage rosters.
- Weekly **matchdays**; **round-robin** between teams (byes for odd counts).
- **Configurable line format** + a **Simple preset** (N organizer-defined doubles/open lines).
- **Captain lineup entry** (organizer can override) → creates child fixtures.
- **Individual line scoring**.
- **Automatic matchup-winner calculation** (roll-up child results → parent).
- **Team standings** (matchup W/L, lines won, point diff, tiebreakers).

**Not included yet:** MLP preset, dreambreaker, gender enforcement, draft tools, advanced
eligibility, home/away, divisions/pools, playoffs.

---

## 6. Future phases

- **Phase 2 — Captain enhancements + self-reporting.** Captains report their matchup's line
  scores; reuse the existing `league_fixtures.reported_by` / `confirmed_by` columns
  (organizer confirms/disputes). Co-captain role.
- **Phase 3 — MLP-style preset.** Women's doubles, Men's doubles, Mixed 1, Mixed 2, and a
  **dreambreaker/tiebreak** line for 2–2. Adds gender enforcement on lineups.
- **Phase 4 — Team playoffs.** Top 2/4/6/8 qualify; reuse the tournament bracket engine on
  **team IDs**, seeded from team standings; each playoff round is a team matchup
  (parent + child lines).
- **Phase 5 — Draft / team-formation tools.** Captain/organizer draft, auto-balance.
- **Phase 6 — Advanced eligibility & substitution rules.** Per-line eligibility, sub
  limits, ringer protection, etc.

---

# Implementation plan (Phase 0 + Phase 1)

> Build plan only — do not execute yet. Apply migrations to prod **before** deploying code
> (project rule). Every migration below is **additive and nullable** so Round Robin, Box,
> and Ladder behavior is untouched.

## Phase 0 — Architecture alignment

**Goal: make the codebase Team-League-ready without changing any existing format's behavior.**

### 0a — Migration (one file, additive)

- Create `league_teams`, `league_team_members` (schema + indexes + RLS deny-all, §4).
- `ALTER league_fixtures ADD` the 5 nullable columns (`team_1_id`, `team_2_id`,
  `winner_team_id`, `team_1_partner_registration_id`, `team_2_partner_registration_id`) + indexes.
- No enum/CHECK changes needed: `format_kind='team'` and `period_kind='matchday'` already exist.
- **RLS review:** new tables deny-all; new columns inherit `league_fixtures` deny-all. No
  existing policy changes.

### 0b — Generalize the standings core (behavior-preserving)

- Today: `computeFixtureStandings()` (`lib/leagues/fixtureStandings.ts`) folds doubles pairs
  by `partner_registration_id` and ranks by win% → diff → H2H → PF → name (shared with
  `lib/tournament/standings.ts`).
- **Extract the pure ranking core into an entity-agnostic function** — `rankEntities(matches, { sideAId, sideBId, winnerId, pf, pa }, nameOf)` — that both the existing
  registration-keyed callers and a future team-keyed caller use. Existing callers wrap it
  with the registration accessor; behavior must be **identical** (pinned by the existing
  box/ladder/RR standings tests).
- No new team logic yet — just the seam.

### 0c — Confirm scheduling reuse (no change needed for MVP)

- `roundRobinMatches(teamIds, base)` is already entrant-generic → usable directly to
  generate parent matchups. **The advanced block/rolling scheduler is NOT needed for the
  MVP** (simple weekly RR). Note for Phase 4: `scheduleBlockMatches()` reads
  `team_*_registration_id` for conflict detection and would need a `getEntityIds(fixture)`
  accessor — defer.

### 0d — Note downstream touch-points (do not build yet)

- **Score route:** the existing single-fixture score route stays as-is; Phase 1 adds a
  child-line roll-up (0 change in Phase 0).
- **Rating extract:** `lib/rating/extract.ts` `fixturesToGames()` will (later) need to read
  the new `team_*_partner_registration_id` for team-line doubles and continue skipping
  parents (already skipped: parents have null `team_*_registration_id`). Flag; don't touch now.

**Phase 0 exit criteria:** migration applied to prod; `rankEntities` seam in place; all
existing tests green; **zero behavior change** for RR/Box/Ladder.

---

## Phase 1 — Playable Team League MVP (PR-sized steps)

Each step is one PR. Order is dependency-driven.

### Step 1 — Team creation + roster (`league_teams` / `league_team_members`)
- API: create/rename/withdraw team; add/remove member; set captain; set member role.
  Server routes under `app/api/leagues/[id]/teams/...` (service-role writes, organizer-gated;
  captain-gated for own-roster edits).
- Data: writes `league_teams` + `league_team_members`; members reference existing
  `league_registrations` (players still register individually via the current flow).
- Audit: `logAudit('league_team', …)`.
- **Depends on:** Phase 0a.

### Step 2 — League creation flow (format + settings)
- `CreateLeagueForm` / `EditLeagueForm`: add a **"Team League"** option; a settings section
  (roster min/max, line config editor, "Simple" preset, roster-lock, `allow_multi_line`);
  persist to `format_settings_json` via `prepareLeagueWrite`.
- `lib/leagues/runSession.ts`: add `format_kind==='team'` nav.
- Add `'team'` branches (skeletons) to `app/(app)/leagues/[id]/{page,standings/page,roster/page}.tsx`.

### Step 3 — Schedule generation (parent matchups)
- Pure: use `roundRobinMatches(teamIds)` to build the matchup rounds; map each round to a
  weekly `league_periods(matchday)`; handle **byes** (odd team count) — the circle method
  already emits them.
- Persist: one `league_periods` row per week + parent `league_fixtures`
  (`match_stage='team_matchup'`, `team_1_id`/`team_2_id`, `period_id`, `status='scheduled'`,
  `scheduled_time`/`court_number` optional/editable).
- **Children are NOT created here** — they're created at lineup time (Step 4).
- Organizer action: "Generate schedule"; manual edit of a matchup's date/court reuses the
  fixture-edit path.

### Step 4 — Lineup management (child fixtures)
- Captain (or organizer override) assigns roster members to each line for a matchday, until
  the roster-lock deadline.
- On save: create child `league_fixtures` (`match_stage='team_line'`,
  `parent_fixture_id`→parent, `team_1_registration_id` [+ `team_1_partner_registration_id`
  for doubles], `team_2_…` for the opponent's chosen players), one per configured line.
- Validation (MVP): player is on the roster; `allow_multi_line` respected; both teams'
  lineups required before scoring. (Gender enforcement deferred to Phase 3.)
- Reuse `AttendanceGrid` for availability; a new lineup assignment UI for line slots.

### Step 5 — Score entry + matchup roll-up
- Enter each child line's score (reuse the fixture score flow: scores → `winner_registration_id`
  → `status='completed'` → `logAudit('league_match', …)`).
- **Pure resolver** `resolveTeamMatchup(parent, children)` → `{ winner_team_id, team1Lines,
  team2Lines, status }`: winner = most lines won; **2–2 tie → `tiebreak` rule** (MVP: point
  differential across lines). Forfeited/incomplete lines counted per status.
- On the last line completing (or organizer "finalize"), write the parent's
  `winner_team_id` + matchup score + `status='completed'`.

### Step 6 — Team standings
- `computeTeamStandings(parentFixtures, teams, opts)` built on the Phase-0b `rankEntities`
  core, keyed on `team_1_id`/`team_2_id`/`winner_team_id`: **matchup W/L → lines won/lost
  → point differential → head-to-head → name**.
- Standings UI: team rows; reuse the shared position/standings presentation
  (`StandingsTable` / `BoxStandings` patterns + the position-by-week grid you already ship).
- Public standings: extend the `/l/[id]` getters for the team branch (later; MVP can be
  authenticated-only first).

### Step 7 — UI screens/components
| Audience | Screens | Reuse |
|---|---|---|
| **Organizer** | Create/Edit Team League; Teams & rosters; Generate schedule; Matchup detail; Score entry; Standings; lineup override | Create/Edit forms, `ManageNav`, `DesktopShell`, `SeededRoster`, fixture/score components, standings components |
| **Captain** | My team (roster) ; set lineup per matchday; (Phase 2) report scores | `AttendanceGrid`, roster manager pattern |
| **Player** | Schedule (my team's matchups); my line assignments; results; standings | league overview + standings |

### Step 8 — Testing plan
- **Unit (pure, `lib/…/__tests__`):**
  - `resolveTeamMatchup`: 3–1, 2–2 tie → tiebreak, forfeit line, incomplete matchup.
  - `computeTeamStandings`: W/L, lines-won tiebreak, point-diff, H2H, determinism.
  - Schedule gen: correct round-robin pairings + **bye** for odd team counts.
  - Lineup validation: roster membership, `allow_multi_line`.
  - `rankEntities` seam: registration-keyed output **identical** to pre-refactor (regression).
- **Regression:** existing box/ladder/RR standings + scheduler tests unchanged; rating
  extract still yields the same game count (parents excluded).
- **Manual checklist:** create team league → create N teams + rosters → generate schedule
  (incl. odd N → bye) → set both lineups → score all lines → verify matchup winner + team
  standings → captain vs organizer permission checks → roster-lock enforcement →
  forfeit/incomplete handling.

---

## Final output

### 1. Recommended build sequence
1. **Phase 0a** — additive migration (tables + fixture columns) — *1 PR*.
2. **Phase 0b** — `rankEntities` standings seam (behavior-preserving) — *1 PR*.
3. **Phase 1 Step 1** — team + roster CRUD.
4. **Step 2** — league create flow (format + line config).
5. **Step 3** — schedule generation (parent matchups).
6. **Step 4** — lineup → child fixtures.
7. **Step 5** — score entry + roll-up.
8. **Step 6** — team standings.
   (Step 7 UI folds into 1–6; Step 8 tests land with each PR.)

### 2. Complexity / risk areas
- **Ad-hoc doubles lineup representation** (2 players/side/line, chosen weekly) — the reason
  for the new `team_*_partner_registration_id` columns. Medium.
- **Roll-up correctness** — ties, forfeits, incomplete matchups, finalize timing. Medium.
- **Standings generalization without regressing box/ladder/RR** — must be behavior-identical;
  pin with existing tests. Medium.
- **RLS/read pattern for team rosters** — deny-all + service-role reads in server components,
  consistent with box/ladder. Low–medium.
- **Rating extract update** (Phase 1/2) — read new partner columns for team lines; keep
  parents excluded to avoid double-counting. Low.
- **Payments model — OPEN DECISION** — MVP assumes players pay individually (existing flow) and
  are assigned to teams. "Team pays once" (captain covers roster) is a real option but a
  bigger change; flagged, not assumed.

### 3. Files likely touched
- **New:** `supabase/migrations/<ts>_team_league.sql`; `lib/leagues/teamMatchup.ts` (roll-up),
  `lib/leagues/teamStandings.ts`, `lib/leagues/teamSchedule.ts` (+ `__tests__`);
  `app/api/leagues/[id]/teams/**`, `.../matchdays/**`, `.../lineup/**`;
  `app/(app)/leagues/[id]/teams/**` UI; team roster/lineup/matchup/standings components.
- **Edited (additive):** `lib/leagues/fixtureStandings.ts` (+ `lib/tournament/standings.ts`)
  for the `rankEntities` seam; `CreateLeagueForm.tsx`, `EditLeagueForm.tsx`, `prepareLeagueWrite`;
  `lib/leagues/runSession.ts`; `app/(app)/leagues/[id]/{page,standings/page,roster/page}.tsx`
  (team branch); `lib/audit/log.ts` (entity types); `lib/rating/extract.ts` (partner columns, later);
  `docs/phases/league-formats.md` + `CLAUDE.md` Current State.

### 4. Anything that contradicts prior architecture assumptions
The reuse-first / parent-child thesis **holds** — no contradictions. One **refinement** the
detailed pass surfaced beyond the strategic review:
- The review said "children keep `team_*_registration_id`." That's true, but doubles lines
  need **two** players per side chosen **ad hoc each week**, which the single
  `team_*_registration_id` can't express and the season-long `partner_registration_id`
  (fixed-partner link) doesn't fit. Resolution: add `team_*_partner_registration_id` to
  `league_fixtures`, mirroring `tournament_matches` rotating-doubles. Still additive, still
  reuse-first — it just makes the child-fixture model honest about ad-hoc pairings.

Two genuinely **open decisions** (not blockers for Phase 0):
- **Payments:** per-player (assumed) vs per-team.
- **Team formation:** organizer-created + assign (MVP) vs self-join/captain-invite vs draft (later).

---

## Open questions to resolve before Phase 1 Step 2
1. Payments: individual (default) or team-level?
2. Team formation for MVP: organizer assigns registered players → confirmed default.
3. Do children share the parent's `period_id`? Recommended **yes** (simpler queries).
4. Public (`/l/[id]`) team standings in MVP, or authenticated-only first? Recommended: auth-only first.
