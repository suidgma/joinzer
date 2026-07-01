# Phase 3 — Multi-device offline run mode (co-organizers + volunteers)

> Status: **design / not built.** Builds on Phase 1 (`offline-scoring-phase-1.md`) and Phase 2
> (`offline-run-mode-phase-2.md`), both shipped. Goal: **more than one person** — the lead
> organizer plus co-organizers and volunteers, each on their own device, each possibly with no
> signal — can run the **same** tournament at once, and everything **converges** correctly when
> devices reconnect.
>
> This is the hardest offline phase because it introduces **concurrent writers**. Read §4 before
> committing to it — there's a real "do we need this yet?" question and a cheaper middle option.

---

## 1. Where Phases 1–2 leave us

Phase 2 gives **one device** the whole tournament offline: cold-load from IndexedDB, score /
check-in / seed-playoffs / reschedule every division, a unified outbox, and a
**drain-then-bulk-refetch** reconcile that replaces the local store with authoritative server state
once the queue is clean (`lib/offline/reconcile.ts`).

That reconcile is explicitly **single-writer**: "only when fully drained → refetch + replace store"
is safe precisely because **nobody else wrote while we were offline**. The bulk-refetch overwrites
untouched rows with server state — which is correct if the server didn't change under us. The
moment a **second** device also writes offline, that assumption breaks: device A's refetch would
either clobber device B's just-synced writes or be clobbered by them, depending on timing. Phase 3
replaces "replace the store" with "**merge** the two op streams."

---

## 2. The new problem: concurrent writers → divergence

Two volunteers, both offline, both scoring their courts. Device A knows scores {1,2,3}; device B
knows {4,5,6}. Neither is wrong; the truth is the **union**. Worse, both might touch the **same**
match (a ref and the organizer both enter court 5's result) with **different** scores — a genuine
conflict that no amount of "last write wins by wall clock" resolves safely, because **offline
clocks skew** and "last" is meaningless without a shared clock.

So Phase 3 needs three things Phase 2 doesn't:
1. A way to **merge** disjoint writes (the common case) without loss.
2. A **deterministic, clock-safe** rule for genuinely concurrent writes to the **same** entity.
3. A **sync protocol** that exchanges *operations*, not *whole-store snapshots*.

---

## 3. The key insight that makes this tractable

This is **not** a general CRDT / collaborative-text problem. The operations are domain-specific,
and almost all of them are already conflict-free:

| Op | Concurrency behavior |
|---|---|
| **Score different matches** | **Commutes** — disjoint entities, union is the answer. (The overwhelmingly common case: each person owns their courts.) |
| **Check-in** | A per-registration boolean. Different players commute; same player set-to-same = no-op; set-to-different = **last-writer-wins**, trivially convergent. |
| **Reschedule** | Per-match court/time = **last-writer-wins**; then re-run the *existing* court-conflict detector and surface a warning. |
| **Seed playoffs** | A **pure function of the standings**, which is a pure function of the base scores. Two devices seeding independently compute the **same** bracket — converges automatically **once the scores converge**. |
| **Bracket advancement** | Already proven a **deterministic function of the score set** (client engine == server engine, Phases 1–2). Converges for free once scores converge. |
| **Score the *same* match differently** | The **one** true conflict. Needs a rule (§8). |

**Therefore:** if we make the **set of match results** converge, everything downstream (standings,
seeding, advancement, the reset row) converges **for free** — we already run the same deterministic
engine everywhere. Phase 3 collapses to: *converge the score set, apply LWW to check-in/reschedule,
and resolve the rare same-match score conflict.* That's an **operation-log merge**, not a CRDT
rewrite.

---

## 4. Decision point — do we need this yet? (read before building)

Honest YAGNI check. Multi-device offline matters **only** when **all** of these hold at once:
- A single event runs on **many courts** with **multiple scorekeepers** (volunteers/refs), **and**
- the venue has **no usable wifi/cell** for those scorekeepers, **and**
- the organizer won't just carry the one device between courts.

For the **Las Vegas pilot**, none of that is confirmed — there's no committed event yet, and most
venues have *some* signal. Phase 2 already covers "the lead organizer runs the whole thing on one
device, offline." That is very likely **enough for the first real events.**

So this doc is deliberately gated. **Cheaper middle options**, in increasing cost — prefer the
lowest that clears the actual need:

- **Option 0 — Do nothing (recommended until an event demands it).** Phase 2 single-device offline
  is the story. Volunteers who *have* signal use the normal online organizer views (already
  multi-user, server-authoritative). Only the **lead** device is offline-capable.
- **Option 1 — Online-only volunteers, offline-only lead.** Explicitly support the common venue:
  volunteers need signal (online, no conflicts — the server serializes them); the lead organizer's
  device is the only offline one. **Zero new conflict code** — it's Phase 2 plus a doc note and a
  UI guard that tells a volunteer "you're offline — reconnect to score." Ships in an afternoon.
- **Option 2 — Full multi-device offline (this doc, §5–§14).** Every device offline-capable, op-log
  merge + conflict resolution. Weeks of work; only justified by a real no-signal multi-court event.

**Recommendation:** ship **Option 1** as a small hardening of Phase 2 now (it removes the foot-gun
of a volunteer silently scoring offline with no way to sync), and hold **Option 2** until a booked
event actually needs it. The rest of this doc specs Option 2 so it's ready when that day comes.

---

## 5. Scope (Option 2)

**In:**
- Every device (organizer, co-organizer, volunteer) can go offline independently and keep operating.
- **Op-log sync:** devices push local ops and pull others' ops through the server; the server is the
  **merge authority** (no peer-to-peer).
- **Convergence:** after all devices sync, every device and the server agree on identical state.
- **Conflict resolution** for same-entity concurrent writes, with an **organizer-visible conflicts
  queue** for the one case that can't be auto-resolved safely (same match, different scores).

**Out:**
- **Peer-to-peer** sync (BLE / local network with no server) — devices only merge *through* the
  server when at least one has signal.
- **Offline generation** (create/generate) — still an online setup action (unchanged from Phase 2).
- Live real-time co-editing presence (who's viewing what). Out.
- Registration / payments / push / email — online only.

---

## 6. Principles

1. **Sync operations, not snapshots.** Phase 2's "replace the store" becomes "apply the merged op
   log." A whole-store refetch is only a cold-start optimization, never the merge mechanism.
2. **The server is the single merge point.** Devices never talk to each other. Convergence happens
   when each device round-trips its ops through the server.
3. **Scores are the source of truth; everything else is derived.** Converge scores → standings,
   seeding, advancement all follow via the existing deterministic engine.
4. **Clock-safe ordering.** No trust in wall clocks across devices. Order with a **hybrid logical
   clock** (HLC) or Lamport counter + a stable `device_id` tiebreak.
5. **Auto-resolve everything that's safe; escalate only the unsafe.** The lone unsafe case
   (same match, two different completed scores) becomes a **dispute** the organizer resolves — never
   a silent overwrite.
6. **Reuse the engine.** Advancement/standings/seeding are the same `lib/tournament` functions.

---

## 7. Data model (Option 2)

### Client
- **`device_id`** — a uuid minted once per install, stored in the local store. Stamped on every op.
- **HLC** — `{ wallMs, counter }` persisted locally; advanced on every local op and on every remote
  op observed (so causality survives clock skew). One tiny module (`lib/offline/hlc.ts`).
- The Phase-2 **outbox** entry gains `op_id`, `hlc`, `device_id`, `entity_type`, `entity_id`,
  `base_version` (the version of the row the op was applied to — for optimistic-concurrency checks).

### Server (new)
```
tournament_ops (                          -- append-only operation log, the merge ledger
  id            bigserial primary key,
  op_id         uuid unique not null,      -- client-minted; dedupes idempotent re-push
  tournament_id uuid not null references tournaments(id) on delete cascade,
  device_id     uuid not null,
  actor_id      uuid not null references profiles(id),
  entity_type   text not null,             -- 'match' | 'registration'
  entity_id     uuid not null,
  op_type       text not null,             -- 'score' | 'checkin' | 'reschedule' | 'seed_playoffs'
  payload       jsonb not null,
  hlc_wall      bigint not null,           -- ordering key (hlc)
  hlc_counter   int not null,
  base_version  int,                       -- entity version the client applied against
  applied       boolean not null default false,  -- did it win / take effect
  superseded_by uuid,                      -- op_id that beat it (LWW / dispute resolution)
  created_at    timestamptz default now()
)
-- index: (tournament_id, id)                        -- pull "ops since cursor N"
-- index: (entity_type, entity_id, hlc_wall, hlc_counter)  -- resolve per-entity ordering
```
- **`tournament_matches.version int not null default 0`** — bumped on every applied write; enables
  optimistic-concurrency detection (op's `base_version` < current ⇒ concurrent).
- **`match_disputes`** (or reuse `audit_log` + a filtered view): `match_id`, `op_a`, `op_b`,
  `status ('open'|'resolved')`, `resolved_op`, so the organizer can pick the correct score.

The **pull cursor** is the last `tournament_ops.id` a device has seen (per device, stored locally).

---

## 8. Conflict taxonomy & resolution

Server-side, applied when an op is ingested (or when the log is reduced). Ordering key throughout is
`(hlc_wall, hlc_counter, device_id)` — total, deterministic, clock-skew-safe.

| Op | Same-entity concurrency | Resolution |
|---|---|---|
| **checkin** | two devices set the same reg | **LWW** by ordering key. Converges; no escalation. |
| **reschedule** | two devices move the same match | **LWW** by ordering key, then re-run the court-conflict detector → warn if double-booked. |
| **score (distinct matches)** | — | Commute; both apply. |
| **score (same match, same result)** | idempotent | First applies; second is a no-op (dedupe by result). |
| **score (same match, different result)** | the one true conflict | **Do not silently overwrite.** Keep the higher-authority actor's result (**organizer > co_organizer > volunteer**); if equal authority, keep the earlier ordering key and mark the other **superseded**. **Either way open a `match_disputes` row + notify the organizer** to confirm. Downstream advancement uses the winning score but is **recomputed** if the organizer flips it. |
| **seed_playoffs** | two devices seed | Pure function of standings → identical output once scores converge; apply idempotently (Phase-2 route already no-ops once seeded). If base scores were themselves disputed, seeding waits on the dispute. |

**Why authority-then-order, not pure wall-clock LWW:** offline wall clocks lie. Role precedence is a
stable, meaningful tiebreak for the rare double-score, and the dispute queue means a wrong auto-pick
is always visible and reversible rather than silently final.

---

## 9. Sync protocol

Replace Phase 2's `reconcile` (drain + replace) with **push/pull/merge** when online:

1. **Push.** POST this device's un-acked outbox ops to `POST /api/tournaments/[id]/ops` (batch).
   Server ingests each: dedupe by `op_id`, apply the §8 rule, bump `version`, append to
   `tournament_ops`, open disputes as needed. Returns the applied/ superseded verdict per op.
2. **Pull.** GET `/api/tournaments/[id]/ops?since=<cursor>` → all ops (from every device) after the
   device's cursor. Apply them locally through the **same** reducer, advance the HLC + cursor.
3. **Merge, don't replace.** Local state = local store **reduced with** the pulled ops. The
   bulk-refetch (`offline-bundle`) is kept **only** as a cold-start / drift-repair path (e.g. first
   ever load, or a "reset from server" button), never the per-sync mechanism.
4. **Converged when** push is fully acked **and** pull returns empty. Surface disputes count.

Server is authoritative on apply; because every device reduces the same total-ordered op log, all
devices + server reach identical state (§11).

---

## 10. Flows

- **Two volunteers, disjoint courts, both offline:** each scores locally (Phase-1/2 engine). On
  reconnect each pushes its ops and pulls the other's → both brackets now hold **all** scores;
  advancement recomputes identically on both. No conflict, no user-visible merge.
- **Ref + organizer score the same court differently, both offline:** both push; server keeps the
  organizer's (authority) and opens a dispute; both devices pull the dispute; the organizer sees
  "Court 5 has two scores" in a **Conflicts** strip and confirms one → a `score` op with the final
  result supersedes and advancement recomputes everywhere.
- **Late joiner / fresh volunteer device:** cold-load via `offline-bundle` (Phase 2), set cursor to
  the current head, then operate. No full-log replay needed for state, only for audit.

---

## 11. Convergence & idempotency argument

- **Dedupe:** `op_id` unique ⇒ re-pushing an op is a no-op (network-retry safe).
- **Total order:** `(hlc_wall, hlc_counter, device_id)` is a strict total order across devices ⇒ the
  reducer is a deterministic function of the **set** of ops, independent of arrival order.
- **Derived state:** standings/seeding/advancement are pure functions of the converged score set
  (already proven in Phases 1–2) ⇒ no separate convergence proof needed for them.
- **LWW ops** (checkin/reschedule): commutative under the total order ⇒ converge.
- **The one escalation** (double score) is resolved to a **single** winning op deterministically;
  the dispute is metadata, not divergent state ⇒ state still converges; humans adjudicate provenance.

Net: after all devices push+pull, every device's reduced store equals the server's ⇒ **strong
eventual consistency** for this domain.

---

## 12. Edge cases & out of scope

- **Two disputes on one match:** collapse to one open `match_disputes` row listing all candidate
  scores; organizer picks once.
- **Volunteer offline for the whole event, never reconnects:** their ops are lost (they never left
  the device). Document; mitigate with Option 1's "reconnect to score" nudge and a local "unsynced N
  changes" badge that persists across relaunches.
- **Clock way off / device reset:** HLC is monotonic per device and advances on observed remote ops,
  so causal order is preserved even with a bad wall clock; the wall component only affects
  *concurrent* tiebreaks, which the dispute queue backstops.
- **Auth expiry offline:** ops stay queued; sync surfaces "sign in to sync" (as Phase 2).
- **Op-log growth:** compact `tournament_ops` after the event completes (snapshot + truncate); it's
  an operational ledger, not permanent state.
- **Peer-to-peer, offline generation, live presence:** out (see §5).

---

## 13. Acceptance criteria (Option 2)

Two+ devices, both put in airplane mode after one online hydrate:
1. Score **disjoint** matches on each → reconnect both → every device shows **all** scores; brackets
   advance identically; **no** disputes.
2. Score the **same** match **differently** on two devices → reconnect → exactly **one** result wins
   by the §8 rule, a **dispute** is raised and visible to the organizer, and resolving it updates
   advancement on **all** devices.
3. Concurrent **check-in** / **reschedule** of the same entity → converges by LWW; reschedule
   double-book raises a warning.
4. Re-pushing the same ops (forced retry) changes nothing (idempotent).
5. A **late-joining** device cold-loads, then receives all prior ops' *effects* via bulk-load + goes
   live with the correct cursor.

Automated: HLC ordering + reducer determinism (property test: shuffle op order ⇒ identical state);
per-rule conflict unit tests; op dedupe; a two-device simulation (no real network) reducing the same
op set on two "devices" and asserting equal stores. Manual: real two-phone airplane-mode pass.

---

## 14. Sequencing (each shippable)

0. **Option 1 first (recommended, tiny):** volunteers must be online to write; the lead device is the
   only offline one. UI guard + doc. No conflict code. Removes the silent-offline-volunteer foot-gun.
1. **HLC + device_id + op envelope** (`lib/offline/hlc.ts`, outbox fields) — pure, tested. No behavior
   change yet (ops still replay as today).
2. **`tournament_ops` + `POST/GET /ops`** — server merge authority with the §8 rules for the *safe*
   ops (checkin/reschedule LWW, disjoint scores). Push/pull wired; still no dispute UI.
3. **Score-conflict + `match_disputes`** — the double-score rule + an organizer **Conflicts** strip
   in run mode to adjudicate.
4. **Swap reconcile → push/pull/merge** in `RunMode`; keep `offline-bundle` as cold-start only.
5. **Two-device simulation tests + real-phone QA** against §13; op-log compaction on completion.

Step 0 is the pragmatic ship. Steps 1–5 are the real multi-writer build, gated on a real event
needing it.

---

## 15. Recommendation

Ship **Option 1** as a short hardening pass on Phase 2 (online-required volunteers + a clear offline
guard), and **defer Option 2** until a booked event has (a) multiple scorekeepers and (b) confirmed
no venue signal. When that event exists, Option 2's build order above is ready. Until then, the
marginal reliability of single-device offline (Phase 2) is almost certainly not worth the
multi-writer merge machinery — and building it now would be speculative complexity against an
unvalidated need. Revisit when the first multi-court, no-signal event is on the calendar.
