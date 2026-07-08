# Player Profile Résumé — Phase 1 Build Plan

> Canonical plan for turning the **public** `players/[id]` page into a player résumé.
> Source of truth for Phase 1. Companion audit ("Player Profile Audit & Redesign Plan")
> was produced in-session; this doc embeds its locked decisions + the facts Phase 1 needs.
> **Status: planned (not built).** Last revised: July 9, 2026.
>
> Do NOT implement ahead of the agreed slice; if code and this doc disagree, the code wins.

---

## Locked decisions (from the audit)

1. **Public `players/[id]` becomes the résumé.** Own `/profile` stays account/settings-focused for now (may later preview the public résumé + edit controls).
2. **Competitive matches only** — tournaments, leagues, ladders, box leagues, round robins. Exclude casual/open play (`events`). A separate "Community Activity" section is a future possibility.
3. **Recent form = last 10 completed competitive matches**, match-level, combined across tournament + league formats; show W/L sequence + last-10 record.
4. **Placements/titles deferred** (no titles/podiums in Phase 1). Future: tournament champion = winner of a specific *division*; league champion = official final standings / playoff winner.
5. **No badges/achievements infra** this phase (no table; count-based badges wait for Phase 2).
6. **Organizer identity is separate** — not built now (future separate page/tab).
7. **Privacy:** public profile stays public; contact info (email/phone) stays private/gated; no new privacy system unless needed.
8. **Add human/personality fields in Phase 1**: bio, preferred formats, dominant hand, preferred side (if easy), home court (already available).

---

## 1. Executive summary

Transform the public `players/[id]` page from a rating card into a **player résumé** using data that already exists. The one new pure module — `lib/rating/stats.ts` — consumes the **existing, tested `GameRecord[]`** from `lib/rating/extract.ts` and derives matches/wins/losses/win%/streak/recent-form/format-splits/competitions-played. No new result-parsing, no stats cache, no badges/placements. The only schema is **four nullable personality columns** on `profiles`. Stats are computed on read for the MVP (current volume is small; Phase 2 moves it into the existing recompute cron if needed). Ships in 6 safe slices, each independently mergeable.

**Load-bearing reuse:** `extract.ts` (match records), `ratingDisplay`/`scoreToLevel` (rating rendering), `Sparkline`, `RatingBadge`, and the home page's existing upcoming-events aggregation.

**Key correctness risk:** `extractAllGameRecords()` fetches *all* records globally; Phase 1 filters to the player in memory (simple + reuses tested transforms). Fine now; the perf ceiling is the Phase 2 trigger.

### Extractor shape (the foundation)
`lib/rating/extract.ts` → `extractAllGameRecords(admin): GameRecord[]`, where each record is
`{ id, playedAt, activity, format:'doubles'|'singles', source:'league'|'tournament', competitionId, occasionId, sideA:string[], sideB:string[], winner:'A'|'B' }`.
It already unifies RR (`league_matches`), box/ladder/flex/team-line (`league_fixtures`), and tournaments (`tournament_matches`); excludes ties, byes (`ladder_bye`/null-reg), drafts, placeholders, and incomplete matches; and derives the winner from score when there's no winner column.

---

## 2. Exact pages/components to change

| File | Change |
|---|---|
| `app/(app)/players/[id]/page.tsx` | **Rewrite** into the résumé (server loader + new sections). |
| `components/features/ProfileEditForm.tsx` | Add bio / dominant hand / preferred side / preferred formats fields. |
| `app/(app)/profile/edit/page.tsx` | Load + pass the new fields. |
| `app/(app)/profile/page.tsx` | Minimal: optional "View my public profile" link. No redesign this phase. |
| `app/(app)/profile/setup/page.tsx` | **No change** — keep signup friction minimal; preferred-play is edit-only. |

---

## 3. Existing components / data to reuse

- `lib/rating/extract.ts` → `extractAllGameRecords(admin)`.
- `lib/rating/display.ts` `ratingDisplay`, `levels.ts` `scoreToLevel` → all Score/Level/confidence rendering.
- `components/ui/sparkline.tsx` → score trend (`profiles.primary_score_history`).
- `components/features/RatingBadge.tsx` → DUPR/self-reported line.
- `RecentResults`/`ResultRow` pattern → visual precedent for W/L.
- Home page upcoming aggregation (`app/(app)/home/page.tsx`) → reuse the upcoming leagues/tournaments query shape (competitive only; exclude `events`).
- `player_ratings` rows → per-format Score; `profiles.primary_*` → fast hero path.
- `locations` join → home court name.

---

## 4. Proposed new components

Co-located under `app/(app)/players/[id]/` (or `components/features/players/`), all presentational:
`PlayerHeroCard`, `PlayerRatingSummary`, `PlayerCareerStats`, `PlayerRecentForm`, `PlayerUpcomingEvents`, `PlayerAboutSection` (bio + preferred-play sub-block).

---

## 5. Proposed new pure stats utility

`lib/rating/stats.ts` (pure, no I/O) + `lib/rating/__tests__/stats.test.ts`.

```
type PlayerStats = {
  matches, wins, losses: number
  winPct: number                                   // wins/(wins+losses), 0 if none
  currentStreak: { type:'W'|'L'; count:number } | null
  recentForm: ('W'|'L')[]                           // last 10 (document order)
  recentRecord: { wins:number; losses:number }      // over the last-10 window
  byFormat: { doubles:{matches,wins,losses}; singles:{matches,wins,losses} }
  leaguesPlayed, tournamentsPlayed, eventsPlayed: number  // distinct competitionId (+ by source)
}
computePlayerStats(records: GameRecord[], userId: string): PlayerStats
```

For each record where `userId ∈ sideA|sideB`: outcome = player's side === winner; order by `playedAt` for streak + recent form; group by `format`; distinct `competitionId`/`source` for played-counts. Server loader: `extractAllGameRecords(admin)` → `computePlayerStats(all, userId)`.

---

## 6. Proposed schema additions

One additive migration, all nullable:
- `profiles.bio text`
- `profiles.dominant_hand text` check in (`left`,`right`,`ambidextrous`)
- `profiles.preferred_side text` check in (`left`,`right`,`either`)
- `profiles.preferred_formats text[]` (values: `singles`,`doubles`,`mixed`)

No stats cache, no badges/achievements/placement/organizer tables.

---

## 7. Data queries / server loader plan

Rewritten `players/[id]/page.tsx` (server):
1. **Profile** (user client): identity + `created_at` + `home_court_id→locations(name)` + the four new fields + DUPR/self-report + `primary_*`. **Never select email/phone for the public view.**
2. **Per-format ratings** (admin; `player_ratings` is RLS deny-all): rows for `player_id` → optional singles/doubles Score.
3. **Career stats** (admin): `extractAllGameRecords` → `computePlayerStats(all, id)`.
4. **Upcoming competitive events** (admin): active `league_registrations` (league not ended) + `tournament_registrations` (future, status registered/confirmed/approved). Exclude `events`.
5. Assemble → presentational components. Own-profile shows the existing Edit affordance.

---

## 8. UI layout plan

Mobile-first single column (widen on desktop), in order: Hero → Rating summary (DUPR rules: self-entered "DUPR 3.72 · self-entered", verified "DUPR 3.72 ✓ Verified", none → omit) → Career snapshot (competitive-only label) → Recent form (W/L pills + "Last 10: 7–3", hidden if 0) → Upcoming events (hidden if none) → About/preferred play (hidden if empty; "Add details" only on own profile). Per-section empty/self-reported/zero-match states.

**Baked-in judgment calls:** recent-form rendered oldest→newest L-to-R with newest emphasized; preferred-play is edit-only (not in signup).

---

## 9. Profile edit form changes

`ProfileEditForm.tsx` gains an optional "About & preferred play" section: bio (textarea, ~280 cap), dominant hand (L/R/Ambi), preferred side (L/R/Either), preferred formats (Singles/Doubles/Mixed chips). Edit page loads + saves the four columns. Setup unchanged.

---

## 10. Privacy considerations

Public shows: display name, photo, Level, Score/status, competitive stats, recent form, home court, bio, preferred play, upcoming competitive events. Never: email, phone, settings, private rating internals (`internal_rating`/RD — Score only). Respect existing `email/phone_visibility` (moot; not queried publicly). No new privacy system this phase (discoverable/hide → Phase 3 if wanted).

---

## 11. Edge cases

- No competitive matches → hide Career/Recent Form (or "No competitive matches yet"); hero still self-reported.
- Self-reported/unrated → `ratingDisplay` self-reported path; no Sparkline (<2 points).
- Byes/forfeits/incomplete/ties → excluded by `extract.ts`.
- Missing winner column → winner derived from score.
- **Subs:** RR credits the physical player; **box/ladder credit the covered entrant, not the sub** (extractor v1 limit) — a sub-only player won't see those box/ladder games. Documented.
- **Team-league lines:** child `team_line` fixtures counted; **format attributed from league-level `format` ('custom'→singles)** → counts correct, split labeling approximate. Documented.
- Doubles: a win credits both partners (both user_ids). Correct for matches played/won.
- Mixed date granularity (session_date / updated_at / scheduled_time) → sort stable by date then id.
- Dummy/removed players: dummies excluded from directory; deleted opponents don't break records.

---

## 12. Testing plan

- **Unit (`stats.test.ts`):** counting, win% (0-match→0), streaks (W/L runs, single, alternating), last-10 window + record, format split, distinct competitions, player-on-sideB, player-absent ignored, empty input.
- **Integration (MCP, read-only):** a real earned player — cross-check matches/W-L vs `player_ratings.games_counted` + spot SQL.
- **Component/render:** earned / self-reported / zero-match / bio-set-vs-empty.
- **E2E (Playwright 375 + desktop):** populated public profile; verify no email/phone leak; edit saves the four fields.
- **Regression:** rating/extract tests stay green (consume, not modify).

---

## 13. Files likely to change

**New:** `lib/rating/stats.ts`, `lib/rating/__tests__/stats.test.ts`, `lib/profile/resume.ts` (loader; optional), `app/(app)/players/[id]/{PlayerHeroCard,PlayerRatingSummary,PlayerCareerStats,PlayerRecentForm,PlayerUpcomingEvents,PlayerAboutSection}.tsx`, `supabase/migrations/<ts>_profile_personality_fields.sql`.
**Edited:** `app/(app)/players/[id]/page.tsx`, `components/features/ProfileEditForm.tsx`, `app/(app)/profile/edit/page.tsx`, optionally `app/(app)/profile/page.tsx`, maybe `lib/rating/types.ts` (export `PlayerStats`).

---

## 14. Migration plan

Single additive migration `<ts>_profile_personality_fields` (bio / dominant_hand / preferred_side / preferred_formats, all nullable, checks where bounded). Apply to prod via Supabase MCP **first**, verify, then commit the file + code (project rule: migrate before deploying code that selects the column). Zero backfill. Ships in Slice 5.

---

## 15. Phased slices

Each independently mergeable; the page keeps working throughout.

- **Slice 1 — Stats utility + tests** (no UI, no schema). `lib/rating/stats.ts` + unit tests. Zero risk.
- **Slice 2 — Server loader.** Assemble profile + per-format ratings + `computePlayerStats` + upcoming competitive events into a typed loader; verify vs real data (MCP). No visible change yet.
- **Slice 3 — Hero + rating block redesign.** `PlayerHeroCard` + `PlayerRatingSummary` wired in; reuse `ratingDisplay`/`Sparkline`/`RatingBadge`. Covers earned + self-reported.
- **Slice 4 — Career snapshot + recent form.** `PlayerCareerStats` + `PlayerRecentForm`; zero-match empty states.
- **Slice 5 — About/preferred play.** Migration (prod-first) → edit-form fields + load/save → `PlayerAboutSection` on the public profile.
- **Slice 6 — Upcoming events + polish.** `PlayerUpcomingEvents` (competitive only) + responsive/empty-state polish + 375px Playwright pass + "View public profile" link on own profile.

---

## Open questions (from the audit, still relevant later)

Phase-1 answers are locked above; these resurface for Phase 2+:
- Placement definition (division-level champion; league playoff/standings) — Phase 3.
- Persist stats cache via the recompute cron once read-time cost bites — Phase 2 trigger.
- Badges: compute-on-read vs persisted — decide when count badges land (Phase 2).
- Organizer identity page — separate surface (Phase 3).
- `discoverable`/hide-profile opt-out — only if richer public exposure warrants it.
