# Phase 2 — Whole-tournament offline run mode (single device)

> Status: **code-complete (steps 1–5 shipped), pending real-device QA.** Builds on Phase 1
> (`docs/phases/offline-scoring-phase-1.md`, shipped). Goal: a single organizer on one device can
> run an **entire** tournament with **zero connectivity** — open it cold offline, check players in,
> score every division, seed playoffs, reschedule, and read standings/schedule — then sync when
> signal returns. Multi-device / co-organizer offline is still **Phase 3** (needs conflict resolution).
>
> Surface: `/tournaments/[id]/run` (`<RunMode>`), reached via **"Run offline"** in the organizer
> manage nav. Store: `lib/offline/tournamentDB.ts` (IndexedDB) + `outbox.ts`; sync:
> `lib/offline/reconcile.ts`.

---

## 1. What Phase 1 already gives us

- **Engine, client-side & pure:** `resolveBracket` / `resolveCompletion` (advancement, byes,
  reset), `computeStandings`, `poolStandings`, `buildAutoSchedule`, the bracket builders, and
  the playoff placeholder/resolution helpers (`buildPlaceholderPlayoffs`, `resolvePlayoffSource`).
- **Offline scoring primitives:** `lib/offline/applyMutations.ts`, `localAdvance.ts`
  (`scoreLocally`, `settleByesLocally`), all tested (single/double elim incl. byes, idempotent).
- **Durable local copy (per division):** `lib/offline/divisionStore.ts` (localStorage snapshot).
- **Outbox:** `lib/pendingQueue.ts` (FIFO, dedupe, drain-on-reconnect).
- **Offline reload:** SW `message` precache + `lib/offline/precache.ts`; `useOnlineStatus`.

Phase 2 widens this from **one division** to **the whole tournament**, adds the **non-scoring**
day-of operations, and makes the day-of surface **cold-load offline**.

---

## 2. The key scoping win: generation stays online

Thanks to the **up-front placeholder bracket** work, a "+ playoffs" division's *entire* bracket
(base matches **and** the labeled playoff placeholders) is created **at setup, online**. So the
day-of offline surface does **not** need to generate matches — it needs to **score, seed
(resolve placeholders), check in, and reschedule** an already-generated tournament. That removes
the hardest reconciliation problem (offline-created rows with temp ids that must map to server
ids). The only temp-id case that remains is the double-elim **reset** row, already handled in
Phase 1 by refetch-on-sync.

**Rule:** generation (create tournament, divisions, courts, generate matches/placeholders) is an
**online setup** action. Offline run mode operates on what setup produced.

---

## 3. Scope

**In:**
- **Bulk hydrate** the whole tournament (all divisions, matches, registrations, courts, meta)
  into a durable local store while online.
- **Cold-open offline:** a run-mode route that boots from the local store with no server fetch.
- Offline **check-in** (incl. QR scan → local roster match), **scoring** (reuse Phase 1),
  **playoff resolution** (seed placeholders from local standings), **reschedule** (court/time),
  and read-only **standings / schedule / live board**.
- One **outbox** for all op types; FIFO replay + idempotent routes; bulk refetch + reconcile on
  reconnect. A tournament-wide offline/sync status.

**Out:**
- **Generation** offline (create/generate) — stays online (see §2).
- **Multi-device** offline (co-organizer + volunteers each disconnected) — **Phase 3**.
- Registration / payments / push / email — online only.

---

## 4. Principles

1. **One durable store per tournament.** IndexedDB (localStorage is too small for a full
   event). All day-of reads/writes go through it.
2. **Local-first for every day-of op.** Apply to the store immediately; enqueue the intent.
3. **Server is source of truth on sync.** Drain the outbox FIFO, then bulk-refetch and replace
   the store.
4. **Single device owns the day.** Sync pushes local → server.
5. **Reuse the engine.** Every offline computation is an existing `lib/tournament` function.

---

## 5. Data model — IndexedDB (`lib/offline/tournamentDB.ts`)

One database, object stores keyed so a whole tournament round-trips. Use a tiny wrapper
(`idb`, ~1 kB) rather than raw IndexedDB ceremony.

```
DB "joinzer-offline"  (versioned)
  store "tournaments"    key: id           → { id, name, status, settings, hydratedAt }
  store "divisions"      key: id           → division rows            (index: tournamentId)
  store "registrations"  key: id           → full reg rows            (index: divisionId)
  store "courts"         key: id           → court rows               (index: tournamentId)
  store "matches"        key: id           → LocalMatch rows          (index: divisionId)
  store "outbox"         key: seq (auto)   → { seq, url, method, body, dedupeKey, enqueuedAt }
```

`matches` extends Phase 1's `LocalMatch` (scores + advancement + `team_*_source`). The outbox
supersedes `pendingQueue` for run mode (ordered by `seq`, dedupe by key), but keeps the same
replay contract.

---

## 6. Offline operations (each: local apply → outbox → idempotent route)

| Op | Local apply | Route (idempotent on replay) |
|---|---|---|
| **Score a match** | `scoreLocally` (Phase 1) → write changed matches | `PATCH /matches/[id]` (guards already in place) |
| **Check in / undo** | set `checked_in` on the reg row | `PATCH /registrations/[id]/checkin` — set to the same value = no-op |
| **QR check-in** | scan → look up token in local `registrations` → set `checked_in` | same as above |
| **Resolve playoffs** | `computeStandings`/`poolStandings` → `resolvePlayoffSource` fills round-1 sources → `resolveBracket` cascade (all pure) | `POST /divisions/[id]/resolve-playoffs` (already idempotent: no-ops once seeded) |
| **Reschedule** | set `court_number` / `scheduled_time` on the match | `PATCH /matches/[id]` or `/schedule` — last-write-wins |

All the compute is existing pure code; Phase 2 wires it to the IndexedDB store + outbox. New
thin client helpers mirror Phase 1's `scoreLocally`: `checkInLocally`, `resolvePlayoffsLocally`,
`rescheduleLocally`.

**Route idempotency to verify/add:** check-in set-to-same-value, reschedule last-write-wins, and
`resolve-playoffs` already early-returns when there's nothing to seed. Score + advancement are
proven idempotent (Phase 1). Add a small integration-style test per new route path.

---

## 7. Run-mode route (cold-load offline)

The day-of pages are server components → can't cold-load offline. Add a **client-rendered**
run route:

- `app/(app)/tournaments/[id]/run/page.tsx` — a thin server shell that renders a single client
  component `<RunMode tournamentId>`.
- `<RunMode>` boots entirely from IndexedDB (via `tournamentDB`): division tabs, court board,
  check-in, scoring (reuses `BracketView`), standings, schedule. No server data fetch on the
  offline path; when online it hydrates the store first.
- **Precache the run shell** on entry (Phase-1 `precachePages(['/tournaments/{id}/run'])`) so an
  offline cold-open serves the cached HTML and `<RunMode>` reads the store.
- Existing online organizer routes are unchanged; run mode is the offline-capable surface (a
  "Run offline" entry from the organizer overview that also **bulk-hydrates**).

This is the largest lift: it's a local-first re-mount of the day-of UI, but it reuses the
existing components (`BracketView`, court cards, check-in) fed from the store instead of props.

---

## 8. Flows

- **Bulk hydrate (online):** "Run offline" (or opening run mode online) fetches the whole
  tournament in a few queries and writes every store; `precachePages` the run shell + each
  division route. One tap, before you lose signal.
- **Operate offline:** every action applies to IndexedDB + appends to the outbox; the UI reads
  the store, so it's instant and survives reloads/relaunches.
- **Cold-open offline:** SW serves the cached run shell → `<RunMode>` reads IndexedDB → full UI,
  no network.
- **Sync (reconnect):** drain the outbox FIFO (all op types) → bulk-refetch → replace the store
  → re-render. Temp reset ids reconcile via the refetch (as in Phase 1).

---

## 9. Code changes

| Area | Change |
|---|---|
| `lib/offline/tournamentDB.ts` | **new** — IndexedDB wrapper: open/upgrade, per-store get/put/bulk, `hydrateTournament(id)`, `drainAndRefetch(id)`. |
| `lib/offline/outbox.ts` | **new** — IndexedDB-backed FIFO outbox (supersedes `pendingQueue` for run mode; same replay contract). |
| `lib/offline/{checkInLocally,resolvePlayoffsLocally,rescheduleLocally}.ts` | **new** — thin local-apply helpers over the pure engine. |
| `app/(app)/tournaments/[id]/run/` | **new** — client-rendered run route + `<RunMode>` shell. |
| organizer components (`CourtCard`, check-in, `BracketView`, standings/schedule) | read from the store in run mode; write via the local helpers + outbox. |
| API routes: `checkin`, `resolve-playoffs`, `schedule`/reschedule | confirm/add idempotent replay; add per-path tests. |
| `public/sw.js` | none needed (Phase-1 precache handler covers the run shell). |

---

## 10. Idempotency & reconciliation

- Score/advancement: proven idempotent (Phase 1).
- Check-in: setting the same `checked_in` value is a no-op.
- Reschedule: last-write-wins on court/time — replay is safe.
- Resolve playoffs: route early-returns once seeded; the fill is deterministic.
- Reconciliation: after draining, a **bulk refetch** replaces the store, so any server-assigned
  ids (the reset row) become authoritative. FIFO drain preserves causal order across op types.

---

## 11. Edge cases & out of scope

- **Never-hydrated tournament offline:** nothing to show — guard with "Open this tournament with
  signal once to make it available offline."
- **Storage limits:** IndexedDB is generous, but bound hydration to the organizer's tournament(s)
  and offer a "clear offline data" control.
- **Auth expiry offline:** cached session; sync surfaces "sign in to sync" (ops stay queued).
- **Two devices:** out of scope. Bulk refetch on sync overwrites untouched rows with server
  state; document single-device. Multi-device = Phase 3 (merge/CRDT).
- **Generation offline:** out of scope (§2).

---

## 12. Acceptance criteria

Single device, airplane mode after one online hydrate:
1. Cold-open the run route offline → full tournament renders from IndexedDB.
2. Check players in (incl. QR) → reflected instantly, survives reload.
3. Score multiple divisions to completion → brackets advance; seed playoffs from standings.
4. Reschedule a match's court/time.
5. Reconnect → outbox drains in order, server state matches local, no dupes; the reset row (if
   any) reconciles.

Automated: local-apply helpers (check-in, resolve, reschedule) unit tests; a store round-trip
test; route idempotency tests per new path. (Scoring/advancement already covered.)

---

## 13. Sequencing (each shippable)

1. ✅ **IndexedDB store + hydrate/refetch** (`tournamentDB`) — pure/data layer, tested. (PR #153)
2. ✅ **Local-apply helpers** (check-in, resolve, reschedule) + route idempotency — pure + small. (PR #154)
3. ✅ **Run-mode route + `<RunMode>` read path** — cold-load offline, read-only first. (PR #155)
4. ✅ **Wire writes** (check-in, score via Phase-1 path, resolve, reschedule) through the store +
   `outbox` (IndexedDB FIFO) + organizer check-in route; tournament-wide sync status. (PR #156)
5. ✅ **Sync/reconcile** (`reconcile.ts`: drain-all scores→outbox, then bulk-refetch + replace store
   only when fully drained — never clobbers un-synced writes; `BracketView` gains `externalSync` so
   run mode owns reconnect). Automated coverage for the store, outbox, local-ops, and reconcile.
   **Remaining: manual airplane-mode QA against §12 on a real phone.**

Step 1 alone (bulk hydrate + store) is the foundation; steps 3–4 deliver the visible "run the
whole thing offline." As in Phase 1, the pure/data layers land first and de-risk the UI work.
