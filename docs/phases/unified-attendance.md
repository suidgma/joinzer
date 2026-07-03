# Unified Attendance & Substitutes

> Status: **design + phased build** (started July 3, 2026)
> Goal: one format-agnostic attendance + substitute capability that works for
> round-robin **and** box leagues today, and every future league type for free.

---

## 1. Why this exists

The attendance grid (Here / Coming / Late / Can't Come / Sub / Not Here) plus the
substitute/guest flow is one of the app's differentiators. Today it only exists
for **round-robin** (`format_kind = 'session_rr'`) because it is wired to the
round-robin *session* model. Box leagues have no attendance at all.

The two formats organize play differently:

| | Round-robin (`session_rr`) | Box (`box`) |
|---|---|---|
| Play unit | **Session** (`league_sessions`) — a scheduled play night | **Cycle** (`league_periods`, `period_kind='cycle'`) — a batch of fixtures |
| Playing roster | `league_session_players` — a **per-night snapshot** with `actual_status` | none — `league_fixtures` reference **registrations** directly |
| Sub | a `league_session_players` row (`sub_for_session_player_id`) that takes the absent player's **match slot**; credit flows to the absent player | doesn't exist |
| Attendance status | `league_session_players.actual_status` + player self-report in `league_session_attendance` | doesn't exist |

Box already keys fixtures **and** standings on the **registration** (the stable
player identity), and there is already a generic `league_periods` table
(`period_kind in ('cycle','window','matchday')`) built for reuse. That is the
seam we build on.

---

## 2. The unified model

Three concepts, one shared table, one shared UI.

1. **Play occasion** — the thing you take attendance *for*. Polymorphic:
   - round-robin → a `league_sessions` row (`session_id`)
   - box / flex / ladder / team → a `league_periods` row (`period_id`)
2. **Attendee** — who is expected. Polymorphic:
   - a **registration** (roster member — both formats), and/or
   - a **guest** (ad-hoc person with no registration — round-robin subs today), with
   - an optional `user_id` when we know the profile (self-report + credit).
3. **Status** — the same six values everywhere:
   `present | coming | late | cannot_attend | has_sub | not_present`.
4. **Substitute** — an attendee row whose `subbing_for` points at the covered
   roster member. The covered member's row is `has_sub`. **Credit always flows to
   the covered registration**, so box promotion/relegation and round-robin scoring
   both stay correct with no special-casing (box gets this for free because
   fixtures/standings already key on registration).

### Proposed schema (proposal — columns will be finalized in the migration)

```sql
league_attendance (
  id                      uuid pk,
  league_id               uuid not null references leagues(id) on delete cascade,
  -- play occasion: exactly one of these is set
  session_id              uuid references league_sessions(id) on delete cascade,
  period_id               uuid references league_periods(id)  on delete cascade,
  -- attendee
  registration_id         uuid references league_registrations(id) on delete cascade,
  user_id                 uuid references profiles(id),
  guest_name              text,
  -- state
  status                  text not null default 'not_present'
                            check (status in ('present','coming','late','cannot_attend','has_sub','not_present')),
  subbing_for_registration_id uuid references league_registrations(id) on delete cascade,
  arrived_after_round     int,
  checked_in_at           timestamptz,
  notes                   text,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
)
-- RLS deny-all; all access via the service-role admin client server-side
-- (matches the box tables). Reads/writes are organizer-gated in the route layer.
```

`league_session_players` **stays** for round-robin — it is the *lineup/slot*
entity that `league_round_matches` point at, which is more than attendance. In the
migration, its `actual_status` / `sub_for_session_player_id` become **derived from
/ mirrored into** `league_attendance`; the round generator reads eligibility from
the unified table.

### Shared UI

Extract the attendance grid + Add-Sub / Assign-Sub modals out of the 1300-line
`LiveSessionManager` into a presentational **`<AttendanceGrid>`** driven by a
normalized `AttendeeRow[]` and callbacks (`onSetStatus`, `onAssignSub`,
`onAddSub`). Round-robin keeps identical behavior; box and future formats render
the same grid.

```ts
type AttendeeRow = {
  id: string                 // attendance row id
  displayName: string
  kind: 'roster' | 'sub' | 'guest'
  status: AttendanceStatus
  subbedByName?: string      // shown on a covered member's row
  coveringName?: string      // shown on a sub's row ("for X")
  teamLabel?: string         // fixed-partner grouping
}
```

---

## 3. Play-night granularity (decision)

**v1 = one attendance sheet per cycle** for box (attendance attaches to the
`league_period`). It matches how box fixtures are batched today and needs no new
per-night table. If a box league later needs multiple play-nights per cycle, we
add a lightweight session-under-period without reworking the attendance table
(the `period_id` occasion just becomes a child occasion). Round-robin is unchanged
(attendance per `league_sessions` row).

---

## 4. Phased plan

Sequenced so **box gets the feature by Phase 3** and the **risky round-robin
migration lands last**, behind everything else being proven.

- **Phase 1 — Extract the shared `<AttendanceGrid>` (no behavior change).**
  Pull the grid + sub modals out of `LiveSessionManager` into a shared component
  driven by `AttendeeRow[]`. Re-mount it in round-robin so it behaves identically.
  Pure refactor; safe; prerequisite for everything.

- **Phase 2 — Generic `league_attendance` schema.**
  Migration for the unified table (applied to prod first, per project rule). No
  behavior change yet — just the table + types + a small data-access helper.

- **Phase 3 — Box attendance + subs.**
  A box "play" surface (reached via the **Run Session** action we already added to
  the league nav) mounts `<AttendanceGrid>` backed by `league_attendance`
  (`period_id` = active cycle) via the service-role admin client. Add/assign subs;
  covered registration keeps the credit. **This delivers the user's core ask.**

- **Phase 4 — Migrate round-robin onto `league_attendance`.**
  Re-point round-robin attendance read/write and round-generation eligibility to
  the unified table; keep `league_session_players` as the lineup entity. Highest
  risk → done last, with the existing scheduler tests as the guardrail.

Each phase is its own PR (or a small stack).

---

## 5. Regression safety

- Phase 1 is a behavior-preserving refactor; the round-robin live page must look
  and act identically.
- `league_attendance` is additive; nothing reads it until Phase 3+.
- The round-robin migration (Phase 4) is the only change to working production
  code and is intentionally last. The scheduler's fairness/eligibility behavior is
  pinned by existing tests in `lib/scheduling` — keep them green.
- Box tables (incl. `league_attendance`) are RLS deny-all + service-role, matching
  the established box pattern in the box API routes.

---

## 6. Open questions

- Should a sub's **own** participation be recorded anywhere (e.g. for the sub's
  match history), or stay fully transparent as today (credit only to the covered
  member)? v1: transparent, matching round-robin.
- Multi-night-per-cycle box play: deferred (see §3).
