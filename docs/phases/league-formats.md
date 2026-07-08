# League Formats — Phase 0 Design & Rollout Plan

> ⚠️ **Design proposal, not current state.** Nothing here is built yet. Reality lives in `/CLAUDE.md` and the codebase.
> This doc is the aspirational target for evolving leagues beyond the current round-robin model.
> Companion to the target-architecture proposal in `@docs/architecture-target.md` (which this deliberately does **not** require).
> Last revised: July 2, 2026.

## Purpose

Evolve Joinzer leagues from a single implicit format (session-based rotating social play) to a **selectable format** model that can support, over time:

1. **Round Robin League** (current) — `format_kind = 'session_rr'`
2. **Box League** — `format_kind = 'box'`
3. **Flex League** — `format_kind = 'flex'`
4. **Ladder League** — `format_kind = 'ladder'`
5. **Team League** (later) — `format_kind = 'team'`

The goal is a **thin generalization layer** that reuses the existing tournament pure-function engine and avoids standing up three separate league systems. Additive, backward-compatible, no change to current production behavior.

---

## The framing insight (from the league-formats audit)

Joinzer already has **two different scheduling paradigms**, and "round robin" means different things in each:

| | **Leagues today** | **Tournaments today** |
|---|---|---|
| Model | *Session-based rotating social play* | *Fixture-based bracket/pool* |
| Match creation | Live, per round, from who is **present** (`lib/scheduling/leagueScheduler.ts` → `generateNextRound`) | All at once up front from the field (`lib/tournament/buildMatches.ts`) |
| "Round robin" means | "give everyone a *fair mix* of partners/opponents" (penalty-scored rotation) | "*complete all-play-all* fixture list" (`roundRobinMatches`, circle method) |
| Match tables | **two**: `league_round_matches` (schedule) + `league_matches` (scores) | **one**: `tournament_matches` (schedule + score + advancement) |
| Standings | bespoke, in `app/(app)/leagues/[id]/standings/page.tsx` | shared pure fn `lib/tournament/standings.ts` `computeStandings` |

**Box** and **Flex** are *fixture-based* → close to the tournament engine.
**Ladder** is a *third* paradigm (challenge-driven, continuously ranked) neither system models.
**Team** is *additive* on the same fixture + period + standings primitives.

### Two verified facts that anchor the design
- `league_registrations` carries **both** `partner_user_id` and `partner_registration_id` (set by the `register_doubles_pair` RPC, `supabase/migrations/20260522000001_pair_solo_registrations.sql`). → a registration-based fixture folds doubles cleanly in `computeStandings`.
- `league_matches` scoring rows are **player-slot based** (`team1_player1_id`…`team2_player2_id`, `team1_score`/`team2_score`, **no `winner` column** — winner is derived). They record *ephemeral pairings*, not stable entrants.

**Hinge:** session-RR matches are *player-combinations*; box/flex fixtures are between *stable entrants*. Forcing box/flex into `league_matches` would be semantically wrong — hence a new `league_fixtures` table.

---

## 1. Phase 0 architecture proposal (smallest safe change)

**Principle: generalize the *entry points*, not the *internals*.** Never touch the `session_rr` scheduler (`lib/scheduling/leagueScheduler.ts`), its tables (`league_rounds`, `league_round_matches`, `league_matches`), or its standings (`app/(app)/leagues/[id]/standings/page.tsx`).

Six smallest-safe, additive changes:
1. `leagues.format_kind` + `leagues.format_settings_json` (default preserves today).
2. `league_fixtures` table (new, registration-based, tournament-shaped) — unused until Box.
3. **Format strategy interface** in `lib/leagues/formats/` dispatching on `format_kind`; the `session_rr` strategy delegates to today's code.
4. **Shared standings core** — generalize `computeStandings` (entity key + scope). session_rr keeps its own path for now; new formats use the core.
5. Close scoring gaps on any *new* league scoring route: audit + notifications + validation + explicit auth (patterns from `app/api/tournaments/[id]/matches/[matchId]/score/route.ts`).
6. Light **period** concept (see §4) for new formats; `session_rr` keeps `league_sessions`.

**Migration concerns:** all additive with safe defaults; apply migrations before deploying code (per CLAUDE.md gotcha). **Risk:** low — the only behavior-affecting change is a dispatch branch that, for `session_rr`, is a pass-through. Main risk is scope creep into session_rr internals; guardrail = "session_rr strategy = thin delegate."

---

## 2. Generalized league format model

- **`leagues.format_kind`** `text not null default 'session_rr'`, check `in ('session_rr','box','flex','ladder','team')`. Existing rows default to `session_rr` → zero behavior change.
- **`leagues.format_settings_json`** `jsonb not null default '{}'`. Mirrors `tournament_divisions.format_settings_json`. Holds per-format knobs (number of boxes, cycle length, window length, challenge range) — never add a column per format.
- **Shared format strategy interface** (`lib/leagues/formats/`):
  - `generateFixtures?(ctx)` → fixture rows (box/flex)
  - `generateNextRound?(ctx)` → round (session_rr delegates to `leagueScheduler`)
  - `standingsScopes()` → `Scope[]` (whole | session | cycle | box | division | matchup)
  - `scoreHandler` → which score path + advancement (none | confirm-gated | rank-mutation)
- **Format-specific scheduling** via strategy: session_rr → `leagueScheduler.ts`; box → `poolPlayMatches`; flex → `roundRobinMatches`; ladder → on-demand.
- **Format-specific standings** via scope + adapter (§6).
- **Format-specific score handling** via strategy: session_rr → `league_matches`; box/flex/team → `league_fixtures`; ladder → ranking mutation.

Net: a league *has a format*; everything format-specific is a strategy + settings blob, not a new subsystem.

---

## 3. League fixture model

**Recommendation: add `league_fixtures`. Do not force box/flex into `league_round_matches`/`league_matches`.**

Why existing tables can't serve fixture formats:
- `league_round_matches` is schedule-only (player-slot assignments, no scores), tied to rounds/session/attendance.
- `league_matches` is player-combination + score, has no stable entrant and no `winner` column — built for ephemeral rotating pairings. Box/flex need a **stable entrant (registration/team)** persisting across the whole fixture, carrying winner, status, window, cycle/box.

Proposed `league_fixtures` (mirrors `tournament_matches` so generators + standings drop in):

| Column | Purpose |
|---|---|
| `id`, `league_id` | identity |
| `period_id`, `box_id` (nullable) | period/box association (§4) |
| `round_number`, `match_number`, `match_stage` | ordering (from generators) |
| `team_1_registration_id`, `team_2_registration_id` | **stable entrants** (FK `league_registrations`) |
| `team_1_score`, `team_2_score`, `winner_registration_id` | result |
| `status` | scheduled / in_progress / completed / forfeited / disputed |
| `court_number`, `scheduled_time` (nullable) | optional placement |
| `window_start`, `window_end` (nullable) | flex/ladder windows |
| `reported_by`, `confirmed_by` (nullable) | flex self-report/confirm |
| `parent_fixture_id` (nullable) | team-league child matches (future, §11) |
| `created_at`, `updated_at` | audit |

**Vs. modifying `league_matches`:** bolting stable-entrant + winner + window + cycle columns onto a player-combination table is semantically wrong and entangles the session_rr path. A separate additive table is lower-risk, leaves session_rr untouched, and mirrors a schema the pure generators already emit.

---

## 4. Competition Period abstraction

**Adopt the *concept*; implement minimally as one light table for new formats — do not retrofit `league_sessions`.**

| Format | Period unit | Representation |
|---|---|---|
| session_rr | week/session | existing `league_sessions` (leave as-is) |
| Box | cycle | `league_periods` row, `period_kind='cycle'` |
| Flex | match window | `league_periods` `period_kind='window'` (or per-fixture window) |
| Ladder | challenge window / continuous | `league_periods` optional; can be periodless |
| Team (future) | matchday/week | `league_periods` `period_kind='matchday'` |

Proposed: `league_periods (id, league_id, period_kind, index, name, starts_on, ends_on, status)`. `league_fixtures.period_id` references it. session_rr does **not** use it (keeps `league_sessions`), so nothing existing changes. One conceptual model, one small additive table, session_rr exempt.

---

## 5. Existing Round-Robin migration path

**Make session_rr the first *registered strategy*, but do NOT migrate its internals now.** This removes "legacy path" status conceptually while preserving 100% of behavior.

- **Phase 0:** set `format_kind='session_rr'` on all existing + new RR leagues. The strategy delegates: `generateNextRound` → existing `generate-next-round` route + `leagueScheduler.ts`; standings → existing `standings/page.tsx`. No table/algorithm changes.
- **Bridge (optional, later):** once the shared standings core supports "individual accumulation + sub-credit," session_rr standings *could* move onto it. Only genuinely non-trivial migration (player-combination + sub-credit ≠ team model), so opt-in and deferred — never a blocker.
- **Full internal migration (session_rr → fixtures): do not do it.** session_rr's value is the ephemeral-pairing rotation; forcing it onto stable-entrant fixtures would *lose* functionality. It's a legitimate distinct strategy, not tech debt.

---

## 6. Shared standings engine

**Generalize `lib/tournament/standings.ts` `computeStandings` into a scope-aware, entity-keyed core; keep the league sparkline/streak UI as a presentation layer over it.**

Current core already accumulates wins/PF/PA, folds doubles, tiebreaks win%→diff→PF→name, and is proven by tournaments. Two generalizations:
1. **Entity key** — accept `entityOf(match, side) → key` to accumulate by **team registration** (box/flex/team) **or by individual user** (session_rr).
2. **Scope filter** — caller pre-filters the match set: whole-league / per-session / per-cycle / per-box / per-division / per-matchup. Scope = "which rows go in," no core change.

Adapters (thin, `lib/leagues/`):
- **Box/Flex/Team:** `league_fixtures` → `StandingsMatchInput` (same shape) → core, scoped by `box_id`/`period_id`.
- **Tournament:** unchanged (already uses the core via `StandingsTab` / `RunStandings`).
- **session_rr (optional/later):** `league_matches` (player-combination) → core in individual-entity mode + sub-credit-cap pre-pass (currently in `standings/page.tsx`). Deferred.

**UI preservation:** sparkline + streak in `app/(app)/leagues/[id]/standings/StandingsTable.tsx` are pure presentation fed by per-scope buckets — keep them; feed per-box/per-cycle buckets for new formats. Consider promoting them to a shared component so tournament standings can use them too.

---

## 7. Shared scoring path

**Build one fixture-scoring route modeled on `app/api/tournaments/[id]/matches/[matchId]/score/route.ts`; treat session_rr's gaps as a separate small cleanup.**

| Concern | session_rr today | Target for fixtures |
|---|---|---|
| Audit | missing | `lib/audit/log.ts` (`league_match` entity exists) |
| Notifications | missing | `lib/notifications/create.ts` (`league` surface exists) |
| Validation | inline, minimal | shared `validateScores` (extract from tournament route) |
| Route auth | relies on RLS | explicit organizer/co-organizer check |
| Self-report (Flex) | n/a | fixture `reported_by`; entrant may report |
| Confirm/dispute (Flex) | n/a | `confirmed_by` + `status='disputed'`; organizer resolves |
| Rank mutation (Ladder) | n/a | score → ranking update (not accumulation) |

Fixture score route: `advancement = strategy-defined` — **none** (box), **confirm-gated** (flex), **rank-swap/ELO** (ladder). Reuse validation + audit + notify; only the post-score action diverges.

---

## 8. Box League — PR-sized plan (after Phase 0)

- **Tables:** `league_periods` (cycle rows), `league_boxes (id, period_id, name, tier_rank, box_size)`, `league_box_members (box_id, registration_id, seed_in_box)`. (`league_fixtures.period_id/box_id` from Phase 0.)
- **Settings** (`format_settings_json`): number of boxes (`num_boxes`, chosen at game time on the Run Session seeding page — not at creation), cycle length/dates, promote/relegate count, tiebreak/standings method, singles-vs-doubles.
- **Cycle creation:** route to open a `league_periods` cycle.
- **Box creation:** seed roster into tiered boxes by rating (reference `components/features/tournaments/SeedingPanel.tsx` `teamRating`) with organizer override.
- **Fixture generation:** `poolPlayMatches(boxMemberRegIds, numBoxes, base, assignments=box membership)` → map rows to `league_fixtures` (`pool_number`→`box_id`). ~full reuse.
- **Per-box standings:** shared core scoped by `box_id`; reuse sparkline/streak UI.
- **Promotion/relegation:** cycle-close resolver — per-box final standings → seed next cycle's boxes. **The one novel algorithm** (analogous to `lib/tournament/poolPlayoffSeeding.ts`).
- **Edge cases:** uneven box sizes (byes handled by generators), mid-cycle dropouts (forfeit vs void), promote/relegate ties (core tiebreak), doubles-in-box decision, sub handling.
- **Reusable tournament fns:** `poolPlayMatches`, `dedupeRegistrationsToTeams` (`lib/tournament/teams.ts`), `computeStandings`, notify/audit. **~70% reuse.**

---

## 9. Flex League — PR-sized plan (after Box)

> **Superseded by `docs/phases/flex-league.md`** (canonical design + Phase 0/1/2 build
> order; decisions locked July 8, 2026: whole-season deadline, self-report/confirm in
> Phase 1, singles-or-fixed-doubles, whole-league standings). The sketch below is retained
> for history.

- **Fixture generation:** `roundRobinMatches` (full or partial all-play-all) → `league_fixtures`; singles or team entrants.
- **Match windows:** stamp `window_start/window_end` per fixture (or per `league_periods` window).
- **Self-scheduling:** entrants agree court/time within window; write `scheduled_time`/`court_number` (optional).
- **Self-reporting:** either entrant sets score → `reported_by`; status → pending confirm.
- **Confirmation/dispute:** opponent confirms (`confirmed_by`) → completed; disputes → `status='disputed'`, organizer resolves.
- **Forfeits/no-shows:** window-expiry cron marks unplayed fixtures forfeited per policy (mirror `app/api/cron/`).
- **Standings:** shared core, whole-league scope.
- **Notifications:** `createNotifications` for "opponent reported — confirm," "disputed," "window closing," "forfeit." **~60% reuse.**

---

## 10. Ladder League — SHIPPED (king-of-the-court / up-down, July 7 2026)

> The original sketch here was a *challenge* ladder. We built a **session-based king-of-the-court ladder** instead — the challenge model was rejected in planning (players wanted structured nights, not on-demand challenges), and a foursome/pod ladder was rejected as redundant with Box. Reuse ended up **~70%**, not ~25%.

- **Format:** `leagues.format_kind='ladder'`. A season-long continuous ranking `ladder_positions (league_id, registration_id, position)` + trend `ladder_position_history` (per-participant per-session before/after/W-L). Entrants = singles or fixed-partner doubles teams (folded via `dedupeRegistrationsToTeams`).
- **Session = `league_periods`** (`period_kind='ladder_session'`). Per-court games = `league_fixtures` (`round_number` + `court_number`, `match_stage` `ladder_round`/`ladder_bye`). Attendance/subs = `league_attendance`. No `league_boxes`.
- **Play (king-of-the-court):** round 1 seeds present entrants onto **courts of 2** by rank; each round the **winner moves up a court, loser down** (`seedKotcRound`/`nextKotcRound`; `rounds_per_session` default 6). Odd → loser-sits bye rotation.
- **Movement:** bounded — `boundedMovement` (odd-even transposition, `max_move` passes, default 3) toward the night's win-% (`computeFixtureStandings`), then `reintegrateRanking` so **absent entrants hold rank**. Subs play for the covered entrant's spot. Organizer confirms via **preview → Finalize** (`/ladder/finalize`); no auto-mutation.
- **Engine:** `lib/leagues/ladder.ts` (pure, 16 tests) + `lib/leagues/ladderServer.ts` (reads/update). Routes `/api/leagues/[id]/ladder/{rank,start-session,round,finalize}`; score reuses `/fixtures/[id]/score`.
- **UI:** Create/Edit format + settings; Roster order editor (reuses `SeededRoster`); Run hub `/leagues/[id]/ladder` (attendance via `BoxAttendanceManager`, rounds via `LadderRounds`); Standings ranking + `▲/▼` + trend; overview player card.
- **Deliberately not reused:** box `applyPromotionRelegation` (leapfrogs a group winner to the tier top — wrong for a continuous ladder).
- **v1 limits / future:** no re-finalize after close (fix scores first, else manual reorder); absent = hold only (decay/penalty later); alternative movement signals (net court movement, ELO) later; open *challenge* ladder still possible on this schema later.

---

## 11. Future Team League — architecture fit check

Supported with additive pieces, no rework:
- **Teams with rosters:** `league_teams` + `league_team_members` (new); entrant = team.
- **Weekly team matchups:** `league_fixtures` row with team entrants, associated to a `league_periods` matchday.
- **Individual matches inside a matchup:** child fixtures via `parent_fixture_id`.
- **Aggregate team scoring:** roll up child fixtures → parent winner (small resolver, like promote/relegate).
- **Standings by team:** shared core, entity key = team.
- **Playoffs:** reuse tournament `singleEliminationBracket`/`doubleEliminationBracket` + `playoffPlaceholders` on team entrants.

Additive on the same primitives → safe "later," not a re-architecture.

---

## 12. Recommended sequencing — confirmed

**Phase 0 → Box → Flex → Ladder → Team.**

| Phase | Reuse | Risk | Product value | Complexity |
|---|---|---|---|---|
| 0 — generalization | — | low (additive) | enabling | low |
| Box | ~70% (poolPlay + standings) | low | high | low–med |
| Flex | ~60% (RR + windows) | med (self-report/dispute) | high | med |
| Ladder | ~25% (new challenge+ranking) | med–high | high but niche | high |
| Team | high on primitives, new roster/nesting | med | high (later) | med–high |

- **Box first** proves the generalization at highest reuse and de-risks the fixture + standings core Flex and Team also need.
- **Flex second** reuses Box's fixture model, adds only windows + self-report.
- **Ladder third** — shares least, two novel subsystems.
- **Team last** — additive on established primitives + reuses the tournament playoff engine.

Refinement: build the shared **fixture-window** primitive in Box/Phase-0 so Flex and Ladder inherit it.

---

## Final recommendation

- **Build first:** Phase 0 as four additive PRs — (1) `format_kind` + `format_settings_json`; (2) `league_fixtures`; (3) shared standings core generalization + adapters; (4) close league scoring audit/notify/validation/auth gaps. Then **Box League**.
- **Refactor first:** extract the shared standings core from `computeStandings` (entity key + scope) and a shared `validateScores`; wire audit/notifications into the fixture score path. These are the leverage points every later format reuses.
- **Avoid:** the unified `competitions` migration (`@docs/architecture-target.md` Path B) — not required, explicitly deferred; migrating session_rr internals onto fixtures (loses the rotating-pairing behavior); per-format tables that reinvent fixtures/periods/standings — everything routes through the three shared primitives (fixture, period, standings core).

---

## Key file references (current codebase, verify before building)

- League scheduler: `lib/scheduling/leagueScheduler.ts` (`generateNextRound`)
- League create: `app/(app)/leagues/create/CreateLeagueForm.tsx`
- League round generation route: `app/api/league-sessions/[sessionId]/generate-next-round/route.ts`
- League scoring UI: `app/(app)/leagues/[id]/sessions/[sessionId]/results/{LockedRoundsScoring,MatchEntryForm}.tsx`
- League standings: `app/(app)/leagues/[id]/standings/{page.tsx,StandingsTable.tsx}`
- League roster: `app/(app)/leagues/[id]/roster/LeagueRosterManager.tsx`
- Session-manager schema: `supabase/migrations/20260428000002_league_session_manager.sql`
- Tournament generators: `lib/tournament/bracketBuilder.ts` (`roundRobinMatches`, `poolPlayMatches`, `singleEliminationBracket`, `doubleEliminationBracket`)
- Tournament match builder: `lib/tournament/buildMatches.ts` (`buildDivisionMatchRows`)
- Standings core: `lib/tournament/standings.ts` (`computeStandings`)
- Team dedupe: `lib/tournament/teams.ts` (`dedupeRegistrationsToTeams`)
- Playoff seeding: `lib/tournament/{playoffPlaceholders,poolPlayoffSeeding}.ts`
- Tournament score route (pattern to mirror): `app/api/tournaments/[id]/matches/[matchId]/score/route.ts`
- Shared: `lib/notifications/create.ts`, `lib/audit/log.ts`, `lib/taxonomy/formats.ts`
