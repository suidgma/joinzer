# League Formats — Phase 1: Box League PR Breakdown

> ⚠️ **Design proposal, not current state.** Companion to `docs/phases/league-formats.md` (architecture) and `docs/phases/league-formats-phase0.md` (Phase 0 breakdown).
> Additive, backward-compatible, **zero change to current production behavior** until a format explicitly opts in.
> Last revised: July 2, 2026.

## Prerequisite: Phase 0 (merged)

Box builds directly on the Phase 0 primitives, all on `main`:
- `leagues.format_kind` (default `'session_rr'`) + `leagues.format_settings_json` — PR #189.
- `league_fixtures` table (registration-based, tournament-shaped; `period_id`/`box_id` present as plain uuid) — PR #190.
- `lib/leagues/fixtureStandings.ts` `computeFixtureStandings()` (scoped per box/period, reuses the tournament `computeStandings`) — PR #193.
- `lib/scoring/validateScores.ts` shared validator — PR #192.

## PR breakdown

| PR | Title | Depends on |
|---|---|---|
| **1.1** | Cycle + box schema (`league_periods`, `league_boxes`, `league_box_members`) + wire `league_fixtures` FKs | Phase 0 |
| 1.2 | Create-league Box settings (`format_kind='box'`, box size, cycle length, promote/relegate) | 1.1 |
| 1.3 | Initial box assignment (seed roster into tiers by rating, organizer override) | 1.1 |
| 1.4 | Cycle fixture generation via `poolPlayMatches` | 1.1–1.3 |
| 1.5 | Per-box standings + UI (reuse `computeFixtureStandings` + sparkline/streak) | 1.4 |
| 1.6 | Fixture score route (reuse `validateScores`; + audit/notify/auth; advancement=none) | 1.4 |
| 1.7 | Cycle close → promotion/relegation → next cycle boxes | 1.5 |

This doc fully specifies **PR-1.1**; 1.2–1.7 are summarized (full rationale in the architecture doc §8).

---

## PR-1.1 — Cycle + box schema

### Goal
Add the three grouping tables Box needs, and finally wire the FK constraints PR-0.2 deferred on `league_fixtures.period_id`/`box_id`. **Additive + UNUSED** — no reader/writer, not wired into `format_kind` dispatch yet.

### Schema (migration authored + applied to prod BEFORE code, per the CLAUDE.md gotcha)
Proposed `supabase/migrations/20260702000006_league_box_schema.sql`:

**`league_periods`** — generic competition-period table (architecture §4). Box uses `period_kind='cycle'`; Flex/Team reuse it later (`'window'`/`'matchday'`).
```
id            uuid pk default gen_random_uuid()
league_id     uuid not null references leagues(id) on delete cascade
period_kind   text not null default 'cycle'
                check (period_kind in ('cycle','window','matchday'))
period_number int  not null                 -- 1-based ordinal (Cycle 1, 2, …)
name          text
starts_on     date
ends_on       date
status        text not null default 'upcoming'
                check (status in ('upcoming','active','completed','cancelled'))
created_at, updated_at
unique (league_id, period_kind, period_number)
```

**`league_boxes`** — a box/tier inside a cycle.
```
id         uuid pk default gen_random_uuid()
period_id  uuid not null references league_periods(id) on delete cascade
league_id  uuid not null references leagues(id) on delete cascade   -- denormalized for scoping/RLS
name       text
tier_rank  int  not null            -- 1 = top box
box_size   int
status     text not null default 'active' check (status in ('active','completed'))
created_at, updated_at
unique (period_id, tier_rank)
```

**`league_box_members`** — a registration's slot in a box.
```
id              uuid pk default gen_random_uuid()
box_id          uuid not null references league_boxes(id) on delete cascade
registration_id uuid not null references league_registrations(id) on delete cascade
seed_in_box     int
created_at
unique (box_id, registration_id)
```
App-level invariant: a registration sits in exactly one box per cycle — enforced in the assignment route (PR-1.3), not by a cross-box DB constraint.

**Wire the deferred `league_fixtures` FKs** (safe — the table is empty):
```
alter table league_fixtures
  add constraint league_fixtures_period_fk
  foreign key (period_id) references league_periods(id) on delete set null;
alter table league_fixtures
  add constraint league_fixtures_box_fk
  foreign key (box_id) references league_boxes(id) on delete set null;
```
`set null`, not `cascade` — box regeneration deletes its fixtures explicitly (mirrors tournament regen deleting matches). Conservative + reversible.

**RLS:** enable on all three tables; **no policies yet** (deny-all to client roles; server writes via the service role), matching the `league_fixtures` pattern. Scoped SELECT policies land with the Box standings reader (PR-1.5).

### Code changes
- `lib/types.ts`: add `LeaguePeriod`, `LeagueBox`, `LeagueBoxMember` types.
- Nothing else — no reader/writer, no dispatch wiring.

### Verification
1. Apply via Supabase MCP; confirm the 3 tables + RLS on + the 2 new FK constraints on `league_fixtures`.
2. Adding the FKs succeeds (empty `league_fixtures` → no rows to violate).
3. `tsc --noEmit` + `next build` clean.
4. Existing leagues + `session_rr` flow untouched.

### Risks & mitigations
- FK on a populated table → none (`league_fixtures` empty).
- Reserved-word column → used `period_number`, not `index`.
- Cross-box uniqueness (reg in two boxes/cycle) → deferred to the PR-1.3 app invariant; noted here so it isn't forgotten.

### Out of scope (later Box PRs — see below)

---

## PR-1.2 — Create-league Box settings (summary)
When `format_kind='box'`, `CreateLeagueForm.tsx` exposes box size, # tiers, cycle length/dates, promote/relegate count, tiebreak/standings method, and singles-vs-doubles into `format_settings_json`. Hides the weekly `play_days`/`games_per_session` fields (box uses cycles, not weekly sessions). Reuses existing FormRow/FormSection primitives. This is the first PR that sets `format_kind` to a non-default value.

## PR-1.3 — Initial box assignment (summary)
Route + roster-page UI (`LeagueRosterManager.tsx`) to seed players into tiered boxes by rating (reference `components/features/tournaments/SeedingPanel.tsx` `teamRating`) with organizer drag-to-adjust. Writes `league_boxes` + `league_box_members`. Enforces the one-box-per-cycle invariant. Reuse `dedupeRegistrationsToTeams` (`lib/tournament/teams.ts`) for doubles entrants.

## PR-1.4 — Cycle fixture generation (summary)
`POST /api/leagues/[id]/cycles/[cycleId]/generate` → `poolPlayMatches(boxMemberRegIds, numBoxes, base, assignments=box membership)` → map rows into `league_fixtures` (`pool_number` → `box_id`, `period_id`=cycle). ~full reuse of the tournament generator. Regeneration deletes the cycle's fixtures first (FKs are `set null`, so deletion is explicit).

## PR-1.5 — Per-box standings + UI (summary)
Server-rendered page (or `format_kind` branch in the standings route) using `computeFixtureStandings(fixtures, regs, { boxId })`. One table per box; reuse the sparkline/streak components from `StandingsTable.tsx`. Adds the first scoped SELECT RLS policies on `league_fixtures`/`league_boxes`/`league_box_members` (participants + organizer).

## PR-1.6 — Fixture score route (summary)
`PATCH /api/leagues/[id]/fixtures/[fixtureId]/score`, modeled on `app/api/tournaments/[id]/matches/[matchId]/score/route.ts`: reuse `validateScores`, add explicit organizer/co-organizer auth, `logAudit` (`league_match` entity), and — pending the product decision below — `createNotifications` (`league` surface). **Advancement = none** (box has no bracket). This is where the Phase-0-deferred "close league scoring gaps" work lands, with a real consumer.

## PR-1.7 — Cycle close → promotion/relegation (summary)
On cycle close, compute per-box final standings (`computeFixtureStandings`), apply promote-top-N / relegate-bottom-N, and seed the next `league_periods` cycle's boxes. The one genuinely novel algorithm in Box — conceptually analogous to `lib/tournament/poolPlayoffSeeding.ts` (standings → new grouping).

---

## Reuse map

| Capability | Source | Status |
|---|---|---|
| Fixture generation (RR within box) | `poolPlayMatches` (`lib/tournament/bracketBuilder.ts`) | Reuse as-is |
| Team dedupe (doubles) | `dedupeRegistrationsToTeams` (`lib/tournament/teams.ts`) | Reuse as-is |
| Standings math (scoped per box) | `computeFixtureStandings` (`lib/leagues/fixtureStandings.ts`) → `computeStandings` | Reuse (Phase 0) |
| Standings UI (sparkline/streak) | `StandingsTable.tsx` | Reuse components |
| Seeding order for box assignment | `SeedingPanel.tsx` `teamRating` | Reference/reuse |
| Score validation | `validateScores` (`lib/scoring/validateScores.ts`) | Reuse (Phase 0) |
| Score route pattern (audit/notify/auth) | tournament score route | Reuse pattern |
| Notifications / audit | `lib/notifications/create.ts`, `lib/audit/log.ts` | Reuse as-is |
| Promotion/relegation | *new* (analogous to `poolPlayoffSeeding.ts`) | **New — the core novel piece** |

---

## Open decisions (resolve before the relevant PR)
1. **Notifications on league score entry?** (PR-1.6) Tournaments notify all match players on score; leagues don't today. Product call before wiring `createNotifications` into the fixture score route.
2. **Box v1: singles-only, or doubles too?** (PR-1.2/1.3) Singles-only is simpler; the fixture model + generators support both.
3. **Box assignment: auto-by-rating with override, or fully manual?** (PR-1.3)
4. **Cycle cadence: fixed dates, or "play by date X" windows?** (PR-1.2) The window variant overlaps Flex and could be built once and shared.

## Edge cases to design for
- Uneven box sizes (odd counts → `poolPlayMatches`/`roundRobinMatches` already emit silent byes).
- Mid-cycle dropouts (forfeit vs void) and their effect on promote/relegate math.
- Promote/relegate ties at the boundary (reuse the `computeStandings` tiebreak chain).
- Sub handling within a box (box fixtures are between specific entrants, so subs are less natural than in `session_rr`).

## Sequencing within Box
`1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7`, each additive and independently verifiable. Box only becomes reachable to organizers at 1.2 (the first PR that sets `format_kind='box'`); everything before that is dormant schema/plumbing.
