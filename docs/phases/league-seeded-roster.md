# Unified Seeded Roster — Design Note & Revised PR Plan

> ⚠️ **Design proposal, not current state.** Companion to `docs/phases/league-formats.md` (architecture) and `docs/phases/league-box-phase1.md` (Box breakdown).
> Design-only. No code yet. Last revised: July 3, 2026.

## Motivation

The Box vertical (PR-1.3) shipped box assignment as a **separate "Boxes" screen** (`/leagues/[id]/boxes`, `BoxManager`: per-box cards + a per-player move-dropdown). Meanwhile tournaments already have a mature **seeded roster** (`components/features/tournaments/SeedingPanel.tsx`): one ordered list with drag-to-reorder, **auto-seed by rating**, save, and replace/comp/remove.

**The realization:** a box assignment *is* a seeded order chunked by box size. Box 1 = seeds 1..N, Box 2 = seeds N+1..2N, etc. So seeding **and** box assignment can be one screen — an ordered roster with **box dividers**, where dragging a player across a divider re-tiers them. That's a cleaner mental model than a separate Boxes screen, and it reuses a proven pattern.

**It also generalizes the whole roadmap.** A seeded roster is the natural input for every seed-based format:
- **Box** — order chunked into tiers.
- **Flex** — fixture seed order.
- **Ladder** — initial ladder positions.
- **Team** (future) — draft order.

So this isn't a box tweak; it's the shared **roster primitive** the rest of the league roadmap wants.

## Proposal

Adopt the tournament seeding *pattern* for seed-based league formats by extracting a shared **`SeededRoster`** component, and make the league roster **format-aware**:

- **Box / Flex / Ladder / Team** → a seeded roster (auto-seed by rating + drag). For **box**, render **box dividers** every `box_size` rows; saving persists the boxes from the order.
- **`session_rr` (current round-robin)** → **unchanged.** That format is rotating social play — the scheduler *ignores* seeds — so a seeding step there would be a meaningless no-op. Its roster keeps today's behavior.

For box specifically, the seeded roster lives **on the Roster screen** (format-aware), and the separate `/boxes` screen + nav item is **removed** — directly answering "seed and re-seed players here, rather than a separate Boxes screen."

## What this does NOT change
- **`session_rr` roster** — untouched (no seeds).
- **League-specific roster management** — co-admin toggle, waitlist, sub-interest, and **fixed-partner assignment** stay. `SeededRoster` handles ordering/seeding; it does not create partnerships. (For box doubles, partners are assigned first, then teams are seeded — the panel folds each pair into one row, as the tournament panel already does.)
- **Box data model** — `league_boxes` + `league_box_members` stay **explicit rows** (needed for box names, promotion/relegation history, per-box standings scoping, and `league_fixtures.box_id`). Only the *input UI* changes: the seeded order → boxes on save. The PR-1.3 assignment engine (`assignBoxesByRating`) and the auto-assign route are reused; `BoxManager`'s per-box-card UI is superseded.

## Component design

Extract the **seeded-list core** out of `SeedingPanel.tsx` (which today also contains a tournament-specific match-schedule/generate card) into a shared `SeededRoster`:

- **Props (generalized):** `items` (entrant id, display name, rating, badges), `isDoubles`, `onReorder`/`onSave`, `onAutoSeed`, optional `onRemove`/`onReplace`/`onComp`, optional **`groupDividers`** (for box: the tier boundaries + labels), and a `saveHandler` (tournament → the `/seeds` route; box → persist boxes from order).
- **Tournament `SeedingPanel`** becomes `SeededRoster` + its existing tournament-only schedule/generate card wrapped around it — behavior-preserving.
- **Coupling to remove during extraction:** `tournamentId`/`divisionId`, the `/seeds` route, bracket integration, and the Invited/Waived stub concepts become injected props/handlers rather than hard-coded.

## Revised PR plan

A small **Seeded Roster** workstream that supersedes PR-1.3's box UI and sets up future formats. It slots in **before/alongside PR-1.4** (fixture generation reads `league_boxes` regardless of how they were populated).

| PR | Title | Notes |
|---|---|---|
| **SR-1** | Extract shared `SeededRoster` | Pull the seeded-list core out of `SeedingPanel.tsx` into a shared component; refactor the tournament panel to use it. **Behavior-preserving** (tournament seeding unchanged). No league changes. |
| **SR-2** | Box roster via `SeededRoster` (drop the Boxes screen) | On the **Roster** page for box leagues, render `SeededRoster` with box dividers; auto-seed by rating + drag; **save persists `league_boxes`/`league_box_members` from the order** (reuse `assignBoxesByRating` for auto; a save-order→boxes path for manual). Remove the separate `/boxes` page + nav item. Keep the assignment engine + routes. |
| SR-3 *(future)* | Flex / Ladder / Team reuse | Those formats adopt `SeededRoster` for fixture seed / ladder positions / draft order. May add a `league_registrations.seed` column at that point (box needs none — boxes persist the order). |

### Revised Box sequence
`1.1 schema` → `1.2 create` → `1.3 assignment engine+routes (UI superseded)` → **`SR-1 + SR-2` (seeded roster)** → `1.4 fixture generation` → `1.5 standings` → `1.6 scoring` → `1.7 promotion/relegation`.

## Reuse map

| Capability | Source | Status |
|---|---|---|
| Seeded list (drag, auto-seed, save) | `SeedingPanel.tsx` → extracted `SeededRoster` | Extract + reuse |
| Auto-seed by rating (box) | `lib/leagues/boxAssignment.ts` `assignBoxesByRating` | Reuse (PR-1.3) |
| Box persistence | `league_boxes` / `league_box_members` + auto-assign route | Reuse (PR-1.3) |
| Team folding (doubles) | `dedupeRegistrationsToTeams` | Reuse |
| Box standings later | `computeFixtureStandings` | Reuse (Phase 0) |

## Open questions
1. **Where does the box seeded roster live** — fully on the Roster page (recommended, matches the ask), or a Roster sub-tab? Either way the standalone `/boxes` screen goes away.
2. **Manual re-tier persistence** — save the whole order and re-chunk into boxes, or keep per-player moves? (Whole-order save is simpler and matches the seeding UX.)
3. **Fixed-partner box doubles flow** — assign partners first (existing UI), then seed teams. Confirm the ordering of those two steps in the UI.

## Recommendation

**Do it — for seed-based formats, not `session_rr`.** It's more than cosmetic: it removes a redundant screen, unifies two roster UIs into one, and creates the shared roster primitive Flex/Ladder/Team all need. Sequence **SR-1 → SR-2** next (superseding PR-1.3's `BoxManager` UI), then continue to PR-1.4. The box data model and assignment engine are unchanged; only the input surface improves.
