# Phase 1 — Offline scoring + local bracket advancement (per division)

> Status: **design / not built.** Scope: a single organizer, on one device, can keep
> scoring a **division** and watch its bracket + standings advance with **zero
> connectivity**, then sync when signal returns. This is the first slice of "run the
> whole tournament offline." Full-tournament run mode and multi-device are later phases.

---

## 1. Why this is feasible now

The entire tournament **engine is already pure, client-side, unit-tested TypeScript** with
no DB dependency:

- `lib/tournament/resolveCompletion.ts` — `resolveCompletion(completed, all)` /
  `resolveBracket(all)` → a list of `Mutation`s (`set` / `complete` / `insert`). This is
  the advancement engine (byes, induced byes, double-elim reset), and it's **deterministic
  and idempotent** (returns `[]` once the bracket is stable).
- `lib/tournament/standings.ts` — `computeStandings(matches, regs, nameOf)`.
- `lib/tournament/bracketBuilder.ts` — `computeBracketReset`, `MatchRow`, etc.
- `lib/pendingQueue.ts` — a localStorage **outbox** (`enqueue` / `drainQueue` / `getQueue`)
  with per-key dedupe, already used by `BracketView` for offline score PATCHes.

Today the client **PATCHes a score and the server runs `resolveCompletion`** (in
`app/api/tournaments/[id]/matches/[matchId]/route.ts` and `…/score/route.ts`). Phase 1
moves that same computation to the client so it works with no server.

Because client and server run the **same deterministic engine**, offline-computed state and
server state converge on sync.

---

## 2. Scope

**In:**
- Score entry offline for a division that was opened online at least once.
- Local advancement (next-round fill, bye auto-advance, double-elim reset) + local standings.
- Durable across an offline page reload (survives a crash / relaunch).
- Outbox + FIFO sync on reconnect; reconcile to authoritative server state.
- Offline/sync status UI.

**Out (later phases):**
- Cold-opening a division never visited online (needs full run-mode + precache — Phase 2).
- Check-in, reschedule, match/playoff generation offline (Phase 2).
- Multiple devices editing offline (needs conflict resolution — Phase 3).
- Registration / payments / push (stay online; not part of running the day).

---

## 3. Principles

1. **Local-first for the day-of division view.** Reads come from the local snapshot; writes
   go to the local snapshot first (optimistic, instant), then to the outbox.
2. **One engine, two runtimes.** The client applies the exact `lib/tournament` functions the
   server uses. No divergent logic.
3. **Server is the source of truth on sync.** After draining the outbox, refetch and replace
   the local snapshot with authoritative server state (real ids, server-applied advancement).
4. **Single device owns the day.** Phase 1 assumes the organizer runs the division from one
   device; sync pushes local → server.

---

## 4. Data model (local snapshot)

Phase 1 uses **localStorage** (one division is small — dozens to low-hundreds of match rows,
well under quota). Phase 2 migrates the whole-tournament store to **IndexedDB**.

```ts
// lib/offline/divisionStore.ts
type DivisionSnapshot = {
  divisionId: string
  tournamentId: string
  updatedAt: number          // last local mutation time
  hydratedAt: number         // last time we replaced from the server
  matches: MatchRow[]        // full working set incl. team_*_source placeholders
  regs: StandingsRegInput[]  // for standings + name resolution
  meta: {                    // enough to render without a server fetch
    bracketType: string
    isDoubles: boolean
    pointsToWin: number
    formatSettings: Record<string, unknown>
  }
}

getSnapshot(divisionId): DivisionSnapshot | null
setSnapshot(snap: DivisionSnapshot): void
key = `jz_div_${divisionId}`
```

The outbox stays `lib/pendingQueue.ts`, keyed by `divisionId` (today `BracketView` keys by
`tournamentId` — Phase 1 re-keys to `divisionId` so sync/refetch is per-division).

---

## 5. Flows

### 5a. Hydrate (online)
On the division view mount **while online**, write `setSnapshot({ matches, regs, meta, hydratedAt: now })`.
The server-rendered props are the seed. (Nice-to-have: SW `cache.addAll([divisionUrl])` so the
route's HTML shell is cached for offline reload.)

### 5b. Score a match (offline OR online — always local-first)
1. In the local matches array, set `team_1_score`, `team_2_score`, `winner_registration_id`,
   `status='completed'` on the scored match.
2. Run `resolveBracket(localMatches)` → mutations; **apply them to the local array** via a new
   pure `applyMutations(matches, mutations)` (mirrors what the score route does to the DB, but
   on the array). This fills next-round slots, auto-completes byes, and inserts the reset match
   (with a temp id `local-reset-<matchId>`).
3. `setSnapshot(...)` and update React state → bracket + standings re-render immediately.
4. `enqueue(divisionId, { url: PATCH /matches/[id], body: scores, dedupeKey: matchId })`.
   (Editing a score replaces the queued op for that match — dedupe already handles this.)

Online, we still enqueue-then-drain (or PATCH directly); the point is **local state advances
without waiting for the server**, so behavior is identical on or off signal.

### 5c. Reload while offline
Server component render is served from the **SW-cached HTML** (network-first nav → cache
fallback, already implemented). The client component then **prefers `getSnapshot(divisionId)`
over the server-baked props** when a snapshot exists → shows current local state incl. offline
scores.

### 5d. Sync (on `online`)
1. `drainQueue(divisionId)` replays outboxed PATCHes **FIFO** — the causal order is preserved,
   so a winner that advanced into a later match server-side is in place before that later
   match's score replays.
2. On success, **refetch** the division's matches from the server and `setSnapshot(...)` with
   the authoritative rows (real ids; reconciles the temp reset id) → update React state.
3. Status → "All changes synced." On partial failure → "N changes pending / retry."

---

## 6. Code changes

| Area | Change |
|---|---|
| `lib/offline/divisionStore.ts` | **new** — snapshot get/set (localStorage). |
| `lib/offline/applyMutations.ts` | **new** — pure `applyMutations(matches, Mutation[]) → MatchRow[]` (set/complete/insert), unit-tested to match the server's apply loop. |
| `lib/offline/localAdvance.ts` | **new** — `scoreLocally(matches, matchId, s1, s2) → { matches, standings }`: sets the score, runs `resolveBracket`, `applyMutations`. |
| `components/features/tournaments/BracketView.tsx` | On save: call `scoreLocally` → update state + snapshot + outbox, instead of relying on the server to advance. Keep the existing "pending sync" badge. |
| `components/features/tournaments/DivisionManageView.tsx` | Hydrate snapshot on mount; prefer snapshot over props when present; wire `online`→drain→refetch→snapshot; render an offline/sync status bar (mirror `LiveSessionManager`). |
| `lib/pendingQueue.ts` | Re-key from `tournamentId` → `divisionId` for score ops. |
| Score routes (`…/matches/[id]`, `…/score`) | **Verify idempotent replay** (see §7). |
| `public/sw.js` | (Optional) precache the division route HTML on hydrate. |

`applyMutations` is deliberately extracted so the same logic is used by (a) the client engine
and (b) tests, and it's the array-equivalent of the DB apply loop already in the score routes.

---

## 7. Idempotency & correctness

- **Replay safety.** The score routes already guard advancement writes: `set` uses
  `.is(field, null)` and `complete` uses `.neq('status','completed')`, and
  `computeBracketReset` refuses a second reset. So replaying the same PATCH is safe — the score
  re-set is the same value, and advancement re-runs to the same stable state. **Action:** add a
  test that PATCHing the same result twice is a no-op beyond the first, to lock this in.
- **FIFO preserves causality.** `drainQueue` iterates the queue in order; an upstream winner's
  PATCH replays before the downstream match that consumed it, so the server fills the slot
  before scoring the dependent match.
- **Reset id reconciliation.** The client inserts `local-reset-*`; the server inserts a real
  row on replay. The post-drain **refetch** replaces the snapshot with server rows, so the temp
  id never persists.
- **Edit-after-advance (known limit, same as online).** `resolveBracket`'s `set` only fills
  **empty** slots, so changing a winner after it already advanced does **not** rewrite the
  downstream slot — identical to current online behavior. Phase 1 does not change this; it's
  called out so we don't imply more.

---

## 8. Edge cases

- **Never-opened-online division:** no snapshot, no cached HTML → not supported in Phase 1
  (Phase 2 run-mode + precache). Guard the UI: if offline and no snapshot, show "Open this
  division once with signal before going offline."
- **localStorage quota / disabled:** `pendingQueue` already falls back to in-memory with a warn;
  snapshot writes do the same. Surface a warning if persistence fails.
- **Auth expired offline:** replayed PATCH uses the cached Supabase session; if expired, sync
  returns 401 → status "Sign in to sync" (scores stay queued, not lost).
- **Two devices:** out of scope. If a co-organizer scores online while the primary is offline,
  the primary's refetch on sync will overwrite local with server state for rows it didn't touch;
  document that Phase 1 is single-device.

---

## 9. Acceptance criteria (test plan)

Manual, single device:
1. Open a division online (bracket renders, snapshot written).
2. Airplane mode. Score several matches across rounds → bracket advances, byes resolve,
   standings update, all instantly, no errors.
3. Reload the page still offline → state persists (from snapshot + cached shell).
4. Re-enable signal → status shows syncing → all scores land server-side; server bracket state
   equals local; no duplicate matches; a double-elim reset (if any) has a real id.
5. Re-score one match offline, sync → the edit (not the original) is what syncs (dedupe).

Automated:
- `applyMutations` unit tests (set/complete/insert parity with the server loop).
- `scoreLocally` play-through for RR+playoffs and pool+playoffs (reuse the existing
  `playoffPlaceholders` / `doubleElimNonPow2` simulation style).
- Route idempotency test (double-PATCH no-op).

---

## 10. Sequencing

1. `divisionStore` + `applyMutations` + `localAdvance` (+ tests). — pure, no UI risk.
2. Wire `BracketView` save → local-first advance + outbox.
3. `DivisionManageView` hydrate + status bar + online→drain→refetch.
4. Route idempotency test; (optional) SW precache of the division route.
5. QA against §9.

Each step is shippable and testable on its own; step 1–2 already delivers "keep scoring on a
dead court, sync later," which is the core value.
