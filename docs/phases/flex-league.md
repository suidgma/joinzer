# Flex League

> Source-of-truth design + build plan for the **Flex League** format. Companion to
> `docs/phases/league-formats.md` (§9 "Flex League — PR-sized plan", which this expands
> and supersedes). If code and this doc ever disagree, the code wins — flag it and update
> this file.
>
> Status: **planned** (not built). Decisions locked July 8, 2026. Last revised: July 8, 2026.

---

## 1. Overview

**Flex League** is a **self-scheduled round-robin**. Each entrant gets an opponent list and
a season deadline, arranges their own court/time with each opponent, plays, and **reports
the score**; the opponent **confirms**. Standings update continuously as matches resolve.

It is the first **player-driven** league format — RR / Box / Ladder / Team are all
organizer-run (the organizer generates rounds and enters scores). Flex's entire value over
Box is that **players self-schedule and self-report**; without that loop, Flex is just a
slow organizer-scored round-robin with no reason to exist. So the self-report/confirm loop
is Phase 1, not Phase 2.

### Locked decisions (July 8, 2026)

1. **Window model = whole-season deadline.** One full round-robin generated up front; an
   entrant may play any of their matches any time before the season's end date. A single
   implicit window = the whole season. (Per-round windows are a Phase 2 setting, not the base.)
2. **Score entry = self-report + confirm, in Phase 1.** Either entrant reports; the opponent
   confirms → completed; a dispute flips the fixture to `disputed` for the organizer to
   resolve. Forfeit/no-show handling (deadline cron) is Phase 2.
3. **Entrants = singles OR fixed-doubles** (mirrors Ladder/Team; folds pairs via
   `dedupeRegistrationsToTeams`). Entrant = a `league_registrations` row (singles) or the
   canonical registration of a fixed pair (doubles).
4. **Standings = whole-league scope**, same shared tiebreak core (win% → diff → H2H → PF → name).

---

## 2. What's already scaffolded (why this is ~60% reuse)

- **`leagues.format_kind`** already permits `'flex'` (constraint `20260702000004`) — no migration.
- **`league_fixtures`** (`20260702000005`) already carries the exact Flex columns:
  - `window_start` / `window_end` — match window (unused in Phase 1's whole-season model; used in Phase 2 per-round windows).
  - `reported_by` / `confirmed_by` (FK `auth.users`) — the self-report/confirm actors.
  - stable entrants (`team_1_registration_id` / `team_2_registration_id`), result
    (`team_1_score` / `team_2_score` / `winner_registration_id`), `status`, `scheduled_time`, `court_number`.
- **Reused pure/proven pieces:**
  - `roundRobinMatches` (`lib/tournament/bracketBuilder.ts`) — all-play-all fixture generation.
  - `computeFixtureStandings` (`lib/leagues/fixtureStandings.ts`) — whole-league standings, same core Team League just used.
  - `validateScores` (`lib/scoring/validateScores.ts`) — no ties per match.
  - `dedupeRegistrationsToTeams` — fold fixed-doubles pairs into one entrant.
  - `createNotification` — the report/confirm/dispute nudges.
  - The Create/Edit-form + `runSession` nav-branch + `format_kind` early-return pattern (done for Box, Ladder, Team).

**Net:** no new tables for Phase 1's core, and **no migration** if we model "reported, awaiting
confirmation" as an existing `status` value (see §4). Everything new is routes + one
player-facing surface + notifications.

---

## 3. The fixture lifecycle (the one genuinely new thing)

A Flex fixture is a small state machine on `league_fixtures`:

```
scheduled ──report──▶ in_progress ("reported, awaiting confirm") ──confirm──▶ completed
                          │                                        └─dispute──▶ disputed ──resolve──▶ completed | forfeited
```

- **scheduled** — created by generation. No scores.
- **report** (either entrant, or organizer on their behalf): writes `team_1_score` /
  `team_2_score` / `winner_registration_id` / `reported_by`, sets `status='in_progress'`.
  Reusing `'in_progress'` to mean "reported, awaiting confirmation" keeps this **migration-free**
  (it's already in the status check). *(Alternative: add a clean `'reported'` status via a
  trivial additive migration — decide at build time; migration-free is the default.)*
- **confirm** (the OPPOSING entrant, or organizer): sets `confirmed_by`, `status='completed'`.
  The reported scores stand.
- **dispute** (the opposing entrant): `status='disputed'`. Surfaces to the organizer.
- **resolve** (organizer only): sets final scores + `status='completed'` (or `'forfeited'`).

**Actor rules (v1):** any user belonging to **either** entrant may **report**; **confirm/dispute**
must come from a user on the **opposing** entrant (you can't confirm your own report). The
organizer/co-admin can do any transition (report on behalf, force-confirm, resolve). A helper
resolves the acting user → their entrant (singles: registration.user_id; doubles: either
partner's user_id → the canonical registration).

---

## 4. Data model

**No new tables for Phase 1.** Knobs live in `leagues.format_settings_json`:

```jsonc
{
  "discipline": "singles" | "doubles",   // entrant type (fixed-doubles → dedupe pairs)
  "match_deadline": "2026-09-30",         // whole-season deadline (or reuse the league's end date)
  "games_to": 11, "win_by": 2,            // scoring (already collected by the create form)
  "double_round_robin": false             // optional: play everyone twice (roundRobinMatches supports it)
}
```

- **Entrant** = `league_registrations` row (singles) or the canonical reg of a fixed pair (doubles).
- **Status** handling: `'in_progress'` = reported/awaiting-confirm (migration-free), `'disputed'`
  = needs organizer. If we prefer an explicit `'reported'` status, that's a one-line additive
  migration extending the `league_fixtures_status_check` — non-breaking, decide at build time.
- **Period:** none required — the whole-season model has one implicit window bounded by
  `match_deadline`. (Phase 2 per-round windows would add `league_periods` rows with
  `period_kind='window'`, already an allowed kind, + per-fixture `window_start/end`.)

---

## 5. Routes (Phase 1)

All under `app/api/leagues/[id]/flex/…`, service-role, audited, gated as noted:

- `POST …/flex/generate` — organizer: `roundRobinMatches` over active entrants → `league_fixtures`
  (`match_stage='round_robin'`). Refuses if any fixture is already reported/completed (dedupe + regen guard, like Box).
- `PATCH …/flex/fixtures/[fixtureId]/report` — an entrant (or organizer): validate scores → set
  scores + `reported_by` + `status='in_progress'`. Notifies the opponent ("confirm your result").
- `PATCH …/flex/fixtures/[fixtureId]/confirm` — the opposing entrant (or organizer): `status='completed'`,
  `confirmed_by`. Notifies the reporter.
- `PATCH …/flex/fixtures/[fixtureId]/dispute` — the opposing entrant: `status='disputed'`. Notifies the organizer.
- `PATCH …/flex/fixtures/[fixtureId]/resolve` — organizer only: final scores + `status`. Clears the dispute.

**Pure seam (mirrors Team League's `teamMatchup.ts`):** extract the transition rules into a small
tested `lib/leagues/flexFixture.ts` (`canReport` / `canConfirm` / `resolveActingEntrant` /
`applyReport` / `applyConfirm`) so the state machine is unit-tested off the routes.

---

## 6. UI surfaces

- **Create / Edit** (`CreateLeagueForm` / `EditLeagueForm`): a "Flex League" format button + a Flex
  settings section (discipline, deadline, games-to/win-by). Same conditional pattern as Box/Ladder/Team;
  hide the RR-only fields.
- **Nav / branch** (`runSession.ts` + `[id]/{page,standings,roster}`): `format_kind==='flex'` →
  organizer overview + a player-facing entry. Standings branch = whole-league (reuse `computeFixtureStandings`
  → a simple table like `TeamStandings`).
- **Organizer overview** (`/leagues/[id]/flex` or a section on the overview): generation button, a
  **progress readout** (X/Y matches completed, N awaiting confirmation, M disputed), a **dispute queue**
  (resolve inline), and the full opponent grid.
- **Player-facing "My Flex matches"** (new — the first player-driven league surface): the viewer's own
  fixtures with per-match actions — **Report score** (if scheduled), **Confirm / Dispute** (if the
  opponent reported), read-only once completed. Lives on the league overview for a registered player.
- **Standings**: reuse the whole-league table; "Latest results" = most-recently-confirmed matches.

---

## 7. Notifications

Reuse `createNotification` with deep links:
- `flex_result_reported` → opponent: "Report entered — confirm or dispute."
- `flex_result_confirmed` → reporter: "Your result was confirmed."
- `flex_result_disputed` → organizer: "A result is disputed."
- *(Phase 2)* `flex_deadline_approaching` / `flex_match_forfeited` — driven by the deadline cron.

---

## 8. Build order

**Phase 0 — verify scaffold (near-zero).** Confirm the `format_kind` constraint + `league_fixtures`
Flex columns exist in prod (they do); settle the `format_settings_json` shape; decide `'in_progress'`
vs. a new `'reported'` status. Likely **no migration**.

**Phase 1 — organizer setup + the self-report/confirm loop (the product):**
1. `lib/leagues/flexFixture.ts` pure state-machine + unit tests (report/confirm/dispute/resolve, actor rules, doubles entrant resolution).
2. Create/Edit form: Flex format + settings; submit writes `format_kind='flex'` + `format_settings_json`.
3. Nav/branch + whole-league standings branch.
4. `flex/generate` route (roundRobinMatches → fixtures).
5. `report` / `confirm` / `dispute` / `resolve` routes (call the pure seam).
6. Player-facing "My Flex matches" surface + organizer overview (progress + dispute queue).
7. Notifications wired to the transitions.
8. Verify: tsc + build + unit tests; live seed→report→confirm→standings round-trip (dummy accounts, torn down); Playwright click-through with the flag on.

**Phase 2 — richer scheduling + lifecycle (deferred):** per-round windows (`league_periods`
`period_kind='window'` + per-fixture `window_start/end`), the **deadline/forfeit cron** (mirror
`app/api/cron/`) with reminders, optional self-scheduling of court/time (`scheduled_time`/`court_number`),
and double round-robin. Player ratings come **for free** already — Flex fixtures are `league_fixtures`
that the rating extractor reads (like Box/Ladder), no extra work.

---

## 9. Edge cases & policies (v1)

- **Both entrants try to report / conflicting reports:** first report wins the "awaiting confirm"
  state; the opponent either confirms it or disputes. A dispute is the conflict-resolution path — no auto-merge.
- **Report your own confirm:** blocked — confirm must come from the opposing entrant.
- **Doubles:** either partner may act for the team; the acting user resolves to the canonical entrant.
- **Withdrawal mid-season:** cancelled reg's fixtures are excluded from standings (same as Box); its
  unplayed fixtures can be voided by the organizer.
- **Re-generation:** allowed only before any fixture is reported (guard like Box's stale-fixture check).
- **No deadline enforcement in Phase 1:** unplayed matches simply stay `scheduled`; the organizer can
  resolve/void them. Automatic forfeits are Phase 2 (cron).

---

## 10. Backward compatibility

Purely additive: a new `format_kind` branch, new `flex/*` routes, one new player surface, a new pure
lib + tests, flag-gated by `NEXT_PUBLIC_ENABLE_FLEX_LEAGUES` (default **OFF**, mirroring Team). No
change to RR / Box / Ladder / Team / tournament code or data. Reused pure functions
(`roundRobinMatches`, `computeFixtureStandings`, `validateScores`, `createNotification`,
`dedupeRegistrationsToTeams`) are **called, not modified** — their tests stay green.

---

## 11. Testing

- **Unit (`flexFixture.test.ts`):** report sets scores + awaiting-confirm; confirm completes; dispute
  flags; resolve overrides; actor rules (can't confirm own report; opponent-only confirm/dispute;
  organizer can do anything); doubles user→entrant resolution; regen guard.
- **Integration (MCP, torn down):** seed a Flex league + entrants → generate → report → confirm →
  standings query returns the right ranking; a disputed fixture surfaces to the organizer.
- **E2E (Playwright, flag on):** create Flex league → generate → (as an entrant) report → (as the
  opponent) confirm → standings; dispute path; mobile 375px on the player surface.
- **Regression:** RR / Box / Ladder / Team / tournament suites stay green.
