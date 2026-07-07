# Joinzer Rating System — Architecture & Decisions

> Source of truth for the player rating / skill system. Strategy is finalized (Rev 2);
> implementation is phased. Phase 0 + Phase 1 are shipping now; the engine and
> multi-sport tables are deliberately deferred. If code contradicts this doc, the code
> wins — flag it and update this file.
>
> Last revised: July 7, 2026 (Rev 2, + Phase 0/1 implementation).

---

## Core decisions

- **Joinzer Score** = the universal, public **0–100** number. Consumer-friendly, mobile-first, motivating, and deliberately **not** on DUPR's 2.0–5.0 scale (we are not a DUPR front-end, and we don't invite direct comparison).
- **Joinzer Level** = the public, **activity-specific label** derived from the Score.
- The **internal rating engine** (future) calculates the Score. The public Score is always a **normalized transform of the internal rating**, never the raw engine value.
- **DUPR is optional and secondary.** Shown only when present, and **manual DUPR is never treated as verified** — verification requires a real integration/import.
- The architecture is **activity-aware**: pickleball is only the first activity. Tennis, ping pong, cornhole, darts, pool, chess, esports, etc. can each define their own formats, 0–100 calibration, and level labels — all sharing one universal Joinzer Score concept.

## Pickleball v1 — public Score → Level bands

| Joinzer Score | Joinzer Level |
|---|---|
| 0–20 | New Player |
| 21–40 | Beginner |
| 41–60 | Intermediate |
| 61–80 | Advanced |
| 81–100 | Elite |

> These **replace** the older player-facing vocabulary (Beginner / Beginner Plus /
> Intermediate / Intermediate Plus / Advanced). The old labels still exist for
> **legacy league/division skill ranges** (2.0–5.0, XL-aligned, in `lib/taxonomy/`) and
> are untouched by Phase 0/1 — that competition vocabulary converges with Score/Level in
> a later phase (see "Open items").

## Level display by lifecycle

```
New / self-reported          Provisional                  Established
────────────────             ────────────────             ────────────────
Intermediate                 Advanced                     Advanced
Self-reported 3.5            Joinzer Score 68             Joinzer Score 74
                             Provisional · 8 matches      Established · 46 matches
```

**Rule:** the numeric **Joinzer Score is shown only once it's calculated** (Phase 2+).
Today (Phase 0/1) we show **Level + self-reported provenance only** — never a Score
number, and never anything implying "Joinzer calculated this."

---

## Naming (final)

| Term | Meaning |
|---|---|
| **Joinzer Score** | Public 0–100 number (calculated; shown Phase 2+) |
| **Joinzer Level** | Public activity-specific label (New Player…Elite for pickleball) |
| **Self-reported rating** | Onboarding input on the sport's native scale (e.g. DUPR 3.5) |
| **DUPR / DUPR rating** | External reference, secondary, verified-only-when-real |
| *internal rating* | Glicko-2 μ (future) — **never shown to players** |

Players say "Score" and "Level"; the engine's raw number is invisible.

---

## Future direction (NOT implemented yet)

- **Internal engine: likely Glicko-2**, doubles-primary for pickleball, computed from
  scored **league + tournament** matches (not casual play). Preserves confidence (RD).
- **Score normalization:** absolute, skill-anchored μ → 0–100 per activity (NOT a live
  population percentile — a player's Score must only move when *they* move).
- **Confidence lifecycle:** Self-reported → Provisional → Established → Rusty. Public
  shows a state word + match count, never a percentage.
- **Formats:** doubles is the primary pickleball rating; singles separate; mixed folds
  into doubles for v1. Public Score resolves to the primary format for the activity.
- **Multi-sport:** `player_ratings (player, activity, format, internal_rating, rd,
  joinzer_score, …)` + `activity_rating_labels (activity, min_score, max_score, label)`
  — config-first in `lib/rating/`, DB table later.
- **Registration gating:** organizer-controlled `ignore | warn | block`, default `warn`,
  expressed in Score/Level terms. Not built yet.

---

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| **0 — Trust cleanup** | `dupr_verified` + `self_reported_rating/scale`; truthful badges; no false verification | **Shipping** |
| **1 — Player identity UI** | Joinzer Level as hero on profiles + directory; self-reported provenance; no Score yet | **Shipping** |
| **2 — Calculated engine** | `player_ratings` table, Glicko-2, normalize to 0–100, activity/format-aware, pickleball first | Deferred |
| **3 — DUPR integration** | Optional, secondary, verified only when a real connect/import exists | Deferred |
| **4 — Multi-sport** | activity label tables, sport-specific formats, per-activity normalization | Deferred |

---

## Phase 0 / 1 — what actually shipped

- **Migration** `20260707000002_rating_phase0_trust_cleanup`: adds `profiles.dupr_verified`
  (bool, default false), `dupr_last_synced_at`, `self_reported_rating` (numeric),
  `self_reported_scale` (`'dupr'|'self'|'other'`). Backfilled from the old fields.
  **Additive** — legacy `dupr_rating` / `estimated_rating` / `rating_source` retained.
- **Shared utility** `lib/rating/levels.ts`: `scoreToLevel(activity, score)` (the single,
  activity-aware label mapping) + `provisionalScoreFromSelfReport()` /
  `selfReportedLevel()` (provisional-only seed so a Level can be shown today).
- **Truthful `RatingBadge`:** a green ✓ appears **only** when `dupr_verified = true`;
  a self-entered DUPR shows "DUPR 3.50 · self-entered" (grey); an estimate shows
  "~3.5 · self-reported". No longer keys verification off `rating_source='dupr_known'`.
- **Identity UI:** own profile, public profile, and the players directory lead with the
  **Joinzer Level** + honest self-reported status; directory filters use the new levels.
- **Write paths:** profile edit + onboarding now also write `self_reported_rating` /
  `self_reported_scale` (and `dupr_verified=false` for self-entered DUPR).

## Open items / decisions still to make

1. **Vocabulary convergence:** player Levels (New Player…Elite) vs competition skill
   labels (Beginner…Advanced+, DUPR 2.0–5.0). Migrate divisions/leagues to Score bands,
   keep two vocabularies, or map on the fly? (Phase 4.)
2. **Score normalization calibration:** which internal μ maps to Score 10/30/50/70/90.
3. **Established threshold:** fixed game count vs Glicko RD cutoff.
4. **Legacy field retirement:** when to drop `estimated_rating` / `rating_source` (kept
   additive for now).
