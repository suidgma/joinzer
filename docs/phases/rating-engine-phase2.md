# Phase 2 — Calculated Rating Engine (Design)

> Design only. NOT built. Implements Phase 2 of `docs/phases/rating-system.md`.
> Turns scored match results into an internal rating → the public **Joinzer Score
> (0–100)**. Pickleball first; architecture is activity/format-aware.
> Phase 2 product decisions **LOCKED July 7, 2026** (§0); engine still parked — no Glicko work.
> Last revised: July 7, 2026.

---

## 0. Locked decisions (July 7, 2026)

Final Phase 2 **product** decisions. The engine stays parked (no Glicko development yet); the
next implementation work remains Phase 0 + Phase 1 only.

**Public scale (unchanged):** 0–20 New Player · 21–40 Beginner · 41–60 Intermediate ·
61–80 Advanced · 81–100 Elite.

**Calibration anchors — what each Score *means*:**

| Score | Meaning | Approx. pickleball (anchor only) |
|---|---|---|
| 10 | true beginner | — |
| 30 | recreational beginner | ≈ DUPR 2.0–2.9 (band 21–40) |
| 50 | average club player | ≈ DUPR 3.0–3.7 (band 41–60) |
| 70 | strong competitive player | ≈ DUPR 3.8–4.5 (band 61–80) |
| 90 | tournament elite | ≈ DUPR 4.6+ (band 81–100) |

These fix the *meaning* of the scale. The remaining numeric step is fitting the normalization
so internal ratings land on these anchors (§4). **Joinzer Score is NOT a DUPR conversion** —
the DUPR figures are approximate intuition anchors only and are never displayed as an equivalence.

**Established — all three must hold:** confidence/`RD` below threshold **AND** ≥ **15** counted
games **AND** ≥ **3** separate events/sessions. The events floor is deliberate: the bar is
*variety of opponents and contexts*, not raw game count. Until all three hold, the player is
Provisional.

**Reconfirmed (v1):** doubles primary · singles separate · mixed folds into doubles ·
**league + tournament matches only** (no casual/open play) · equal league/tournament weighting ·
no margin-of-victory.

---

## 1. Scope

**In:** an internal per-(player, activity, format) rating engine (Glicko-2), a normalization
to the public 0–100 Joinzer Score, the confidence lifecycle (Provisional → Established →
Rusty), a `player_ratings` table + `profiles` cache, and a deterministic recompute job
that reads completed **league + tournament** games.

**Out (later phases):** DUPR API/verification (Phase 3), multi-sport activity tables +
per-division Score bands + registration gating (Phase 4). Casual/open-play sessions do
**not** feed the rating (unreliable scores).

**Guiding property:** the recompute is a **pure function of match history** — idempotent,
so "backfill" is just "run it once," and re-running never drifts.

---

## 2. Inputs — the normalized `GameRecord`

Everything the engine consumes is reduced to one shape. Each scored row in Joinzer is a
**single game** (to `points_to_win`; no best-of, no `game_scores` array anywhere), so one
source row = one `GameRecord` = one binary outcome.

```ts
type GameRecord = {
  id: string                    // source row id (idempotency / debug)
  playedAt: string              // ISO timestamp → chronological order + rating periods
  activity: 'pickleball'
  format: 'doubles' | 'singles' // mixed folds into 'doubles'
  source: 'league' | 'tournament'
  competitionId: string         // league_id / tournament_id (for future weighting)
  occasionId: string            // distinct session/cycle/tournament — powers the ≥3-events
                                //   Established gate. league RR → session_id; box/ladder →
                                //   period_id; tournament → tournament_id.
  sideA: string[]               // user_ids — 1 (singles) or 2 (doubles)
  sideB: string[]
  winner: 'A' | 'B'
}
```

### 2a. Round-robin leagues → `league_matches`
- `team1_player1_id / team1_player2_id / team2_player1_id / team2_player2_id` are **`profiles.id` (user_ids)** — already resolved. `sideA = [t1p1, t1p2].filter(Boolean)`, `sideB` likewise.
- Winner from `team1_score` vs `team2_score` (single game). `playedAt` = `league_sessions.session_date`.
- Format from `leagues.format` via `isDoublesFormat()` (`lib/taxonomy/formats.ts`).
- **Subs are already the physical players** — the sub's `user_id` is what's stored in `league_matches` (standings redirect credit to the absent member, but the *match row* holds who actually played). ✅ Rate who played, for free.

### 2b. Box + ladder leagues → `league_fixtures`
- `team_1_registration_id / team_2_registration_id` → resolve via `league_registrations`:
  `user_id` (+ `partner_user_id` for doubles) → `sideA`/`sideB`.
- Winner from `winner_registration_id` (or score compare). Only `status='completed'`.
- **Exclude** `match_stage='ladder_bye'` (one-sided). `playedAt` = period/fixture time.
- Format via `leagues.format` / `isDoublesFormat()`.
- **Subs:** the fixture references the *covered entrant's* registration; the physical sub
  lives in `league_attendance` (`status='has_sub'`, `subbing_for_registration_id`, `user_id`).
  **Decision (v1):** overlay the sub — swap the covered entrant's `user_id` for the sub's
  `user_id` so the person who played is rated. If the overlay is deferred, rate the entrant
  and note the small inaccuracy. Guest subs (`guest_name`, no `user_id`) → **skip that game**.

### 2c. Tournaments → `tournament_matches`
- Fixed-partner doubles / singles: `team_1_registration_id`, `team_2_registration_id` →
  `tournament_registrations.user_id` (+ `partner_user_id`).
- **Rotating doubles:** four reg ids — `team_1_registration_id` + `team_1_partner_registration_id`
  and `team_2_registration_id` + `team_2_partner_registration_id` → four user_ids, 2 per side.
- Format from `tournament_divisions`: `team_type` (`singles`/`doubles`) + `category`
  (`mens_doubles`/`womens_doubles`/`mixed_doubles`/`singles`/`open`). `mixed_doubles` → `doubles`.
- Winner from `winner_registration_id`. `playedAt` = `scheduled_time` ?? `updated_at`.
- **Exclusion filter (must all hold):**
  `status='completed'` AND `team_1_registration_id` not null AND `team_2_registration_id`
  not null AND `is_draft=false` AND `team_1_source is null` AND `team_2_source is null`.
  (BYEs have a null side; draft/placeholder rows aren't real results.)

### 2d. Universal skip rules
Skip a `GameRecord` if a side is empty, a side has an unratable participant (guest sub with
no `user_id`), or `sideA`/`sideB` share a user_id (data error). Cancelled/disputed → excluded
by the `status='completed'` gate.

---

## 3. The engine — Glicko-2, doubles-adapted

**Why Glicko-2:** it carries **rating deviation (RD = uncertainty)** and **volatility**
natively — which *is* the confidence lifecycle — converges fast for new players, and grows
RD over inactivity (→ "Rusty") for free. Elo lacks this; TrueSkill is heavier. (See Rev 2 §4.)

Standard Glicko-2 state per (player, activity, format): rating `r` (μ), `RD` (φ), volatility
`σ`. Work on the internal Glicko-2 scale (`μ=(r-1500)/173.7178`, `φ=RD/173.7178`), system
constant `τ≈0.5`.

### 3a. Rating periods
Process games in **weekly buckets** (ISO week of `playedAt`), chronologically. Uniform across
leagues + tournaments. Each bucket = one Glicko-2 update per player from that week's games.
Empty weeks grow φ (`φ' = √(φ² + σ²)`), applied in one step across elapsed idle weeks (no
per-week loop) → inactivity decay without O(weeks) cost.

### 3b. Doubles adaptation (the one approximation)
For a doubles game, each player on a side is updated as if playing a **single virtual
opponent = the opposing team's aggregate**:
- `μ_opp = mean(opponents' μ)`, `φ_opp = √(mean(opponents' φ²))` (RMS).
- Each teammate updates against `(μ_opp, φ_opp)` with the game outcome (their own φ drives
  their own movement). Partner strength enters via the opponent-average affecting expected
  score. This is the standard "average-team-rating" method — an approximation (no full
  TrueSkill credit assignment), explicitly accepted for v1 and flagged for later revisit.
- Singles = the degenerate case (one opponent, no aggregation).

### 3c. Outcome model
**Win/loss only, per game** — `s = 1.0` (win) / `0.0` (loss). **No margin-of-victory** in v1
(avoids score-running incentives; single-game granularity already reflects dominance across a
session). MoV is a future capped multiplier.

---

## 4. Normalization — internal rating → Joinzer Score (0–100)

Public Score = `normalize(activity, r)`: **monotonic, absolute (skill-anchored, NOT a live
population percentile — a player's Score must move only when *they* move), per-activity.**

Recommended form — clamped logistic:
```
score = clamp( round( 100 / (1 + exp(-(r - r_mid) / s)) ), 0, 100 )
```
with per-activity `r_mid`, `s`. The **score anchors are locked** (§0: 10/30/50/70/90 with their
meanings); the only remaining step is the numeric fit — choose `r_mid`/`s` so internal ratings
land on those anchors, sanity-checked against a few known-DUPR players. Joinzer Score is not a
DUPR conversion. `scoreToLevel(activity, score)`
(already shipped in `lib/rating/levels.ts`) turns the Score into the Level label.

**Seeding (inverse):** initial `r` from `self_reported_rating` →
`provisionalScoreFromSelfReport()` → `scoreToInternal(score)` (inverse of the logistic).
`RD` seed = **350** (max uncertainty) for self-report, **~150** if `dupr_verified`, `basis='seed'`.
No self-report → New-Player-band `r`, `RD=350`.

---

## 5. Confidence lifecycle

| State | Rule (tunable) | Public display |
|---|---|---|
| **Provisional** | `RD ≥ ~110` (Glicko scale) **or** `games_counted < ~10` | Level + "Provisional · N matches" (no Score number if you prefer, or Score shown but tagged) |
| **Established** | `RD < ~110` **and** `games_counted ≥ 15` **and** `events_counted ≥ 3` (distinct sessions/tournaments — variety, not just quantity) | Level + **Joinzer Score** + "Established · N matches" |
| **Rusty** | Established but idle → `RD` regrown past threshold | Level + "Rusty · last played …" |

Public shows a **word + match count**, never a percentage. `confidence_state` is derived from
`RD` + `games_counted` + `events_counted` (distinct `occasionId`s) + `last_played_at` and cached
for cheap reads.

---

## 6. Data model

```
player_ratings                         -- engine source of truth
  player_id        uuid  fk profiles
  activity         text  default 'pickleball'
  format           text  'doubles' | 'singles'   -- mixed folds into doubles
  internal_rating  numeric              -- Glicko-2 r (private)
  rating_rd        numeric
  rating_volatility numeric
  joinzer_score    integer              -- 0–100 cache
  games_counted    integer
  events_counted   integer              -- distinct sessions/tournaments (Established gate)
  basis            text  'seed' | 'calculated'
  confidence_state text  'provisional' | 'established' | 'rusty'
  last_played_at   timestamptz
  updated_at       timestamptz
  primary key (player_id, activity, format)

player_rating_history                  -- optional: profile trend + auditing
  id, player_id, activity, format, as_of, internal_rating, joinzer_score, games_counted

profiles  (cache for lists/filters; recomputed with the rating)
  primary_activity        text default 'pickleball'
  primary_format          text
  primary_joinzer_score   integer
  primary_joinzer_level   text
```

Additive migration. `profiles.joinzer_rating` (old 1000-scale seed) is retired here; the
public value is `primary_joinzer_score`. Legacy `self_reported_*` remain (they seed + drive
the pre-Established Level).

---

## 7. Orchestration — recompute strategy

**v1 = deterministic full-history recompute** (simplest + correct + free backfill):
1. Extract all competitive `GameRecord`s (leagues §2a/2b + tournaments §2c), sort by `playedAt`.
2. Seed every participant's initial `r/RD/σ` from `profiles.self_reported_*` (§4).
3. Bucket by ISO week; run Glicko-2 per period, routing each game to the `(activity, format)`
   bucket; grow φ across idle weeks.
4. Write `player_ratings` (+ history snapshot) and the `profiles` cache; derive `confidence_state`.

Idempotent — re-running from source yields the same result. **Triggers:** nightly cron
(existing cron infra) **+** enqueue-on-finalize when a tournament completes or a league session
is scored **+** an admin "Recompute ratings" button. Incremental per-match updates are a later
optimization; at Joinzer's scale (hundreds of players, thousands of games) full recompute is fine.

---

## 8. Format / activity routing

- **Doubles is the primary pickleball rating** and the public Score. **Singles** is a separate
  `player_ratings` row, surfaced only where singles is played. **Mixed → doubles.**
- The `profiles` cache holds the **primary** (doubles; fall back to singles if that's all a
  player has). Public Score/Level resolve to the primary.
- Activity is fixed `'pickleball'` in v1; the (activity, format) key means Phase 4 sports are
  additive.

---

## 9. Edge cases & decisions

- **Subs:** rate the physical player. RR: free (user_id is in the match). Box/ladder: overlay
  from `league_attendance` (v1) or rate the entrant + note the gap. Guest subs → skip that game.
- **BYEs / draft / placeholder / cancelled / disputed:** excluded (§2c filter, ladder_bye skip).
- **Rotating doubles:** 4 reg ids → 4 user_ids, 2/side.
- **Thin data:** players with few games stay Provisional (correct — don't show an unearned Score).
- **Determinism:** games within a period are processed as a set (order-independent); recompute is reproducible.
- **Weighting:** league vs tournament equal in v1, behind a per-source constant for later.

---

## 10. UI changes (when the engine lands)

- **Joinzer Score appears at Established** (profiles, directory). Pre-Established stays Level +
  self-reported (as shipped in Phase 1) — nothing implies an unearned calculation.
- Profile gains Score + confidence state + `games_counted` + a **rating trend** (from
  `player_rating_history`; reuse `Sparkline`).
- Directory can sort/show Score for Established players; `RatingBadge` (self-report) is unchanged
  and recedes to secondary.

---

## 11. Module / file plan (for the implementation session)

- `lib/rating/glicko2.ts` — pure Glicko-2 core (r/RD/σ; period update). No DB.
- `lib/rating/engine.ts` — doubles aggregation, period bucketing, orchestration over `GameRecord[]`. Pure.
- `lib/rating/normalize.ts` — `scoreFromInternal(activity, r)` + `internalFromScore` (seed). Pure.
- `lib/rating/__tests__/*` — engine + normalize + doubles + inactivity + determinism.
- `lib/rating/extract.ts` (server) — DB → `GameRecord[]` for leagues + tournaments (the trickiest, most-tested piece).
- `lib/rating/recompute.ts` (server) — extract → engine → write `player_ratings` + history + cache.
- `app/api/rating/recompute/route.ts` (admin) + cron entry.
- `supabase/migrations/…_rating_engine.sql` — `player_ratings`, `player_rating_history`, `profiles` cache cols.

---

## 12. Testing plan

- **`glicko2.ts` vs the published worked example** (Glickman's Glicko-2 paper) — exact numbers.
- **Doubles aggregation** — team average/RMS; both teammates move sensibly; upset vs strong team.
- **Convergence sim** — strong player rises, weak falls, over many periods.
- **Inactivity** — RD grows across idle weeks → Rusty.
- **Seeding** — self-report → μ/RD; verified DUPR → lower RD.
- **Normalization** — monotonic, clamped, anchor points hit their bands, `internal↔score` round-trips.
- **`extract.ts`** — per-format resolution: RR user_ids, box/ladder reg→user+partner, tournament
  fixed/rotating, all exclusion filters, sub overlay, guest-skip.
- **Determinism** — recompute twice ⇒ identical output.

---

## 13. Rollout sequence

1. Additive migration (`player_ratings`, history, `profiles` cache).
2. Pure engine (`glicko2` + `engine` + `normalize`) + tests — nothing wired.
3. `extract.ts` + tests (verify against a few real completed competitions).
4. `recompute.ts` + admin trigger; **run the backfill once**; verify a handful of players by hand.
5. Cron + on-finalize enqueue.
6. UI: Score at Established + profile trend + directory.
7. **Calibrate** the normalization anchors (§14) before the Score goes public.

---

## 14. Open questions / calibration

1. **Rating period length** — weekly (recommended) vs per-competition-event.
2. ~~**Established threshold**~~ — **LOCKED (§0):** `RD` below threshold AND ≥15 games AND ≥3 events.
3. **Normalization anchors** — **score anchors LOCKED (§0):** 10/30/50/70/90 with meanings. Remaining:
   the numeric `r_mid`/`s` fit to those anchors (sanity-check vs known-DUPR players) before launch.
4. **Sub crediting for box/ladder** — physical sub (overlay) vs covered entrant.
5. **Singles sparsity** — singles may rarely reach Established; is Level-only acceptable there?
6. **League vs tournament weight** — equal for v1; revisit.
7. **Show Score pre-Established at all?** — recommend no (Level only until earned).

## 15. Risks

- Doubles aggregation is an approximation (mitigated by RD/volatility; revisit if it mis-ranks).
- Thin data ⇒ many players stuck Provisional (feature, not bug — but manage expectations).
- Calibration drift / perception when Scores first appear or move.
- Recompute cost grows with history (fine now; incremental later).
- Mixed-into-doubles fairness for mixed-heavy players (accepted v1; separate mixed later).
