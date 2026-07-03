# Unified Attendance & Substitutes

> Status: **shipped** (July 3, 2026). Phases 1–3 merged. Phase 4 (round-robin
> storage migration) was evaluated and **intentionally not pursued** — see §4.
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

- **Phase 1 — Extract the shared `<AttendanceGrid>` (no behavior change). ✅ DONE (PR #225).**
  Pulled the grid out of `LiveSessionManager` into
  `components/features/leagues/AttendanceGrid.tsx` driven by `AttendeeRow[]`.
  Round-robin behaves identically.

- **Phase 2 — Generic `league_attendance` schema. ✅ DONE (PR #226).**
  `league_attendance` table applied to prod; `LeagueAttendance` types; the shared
  `AttendeeRow` type + the pure `buildAttendeeRows` substitute-overlay resolver
  (`lib/leagues/attendance.ts`, unit-tested). Still unused by any reader/writer.

- **Phase 3 — Box attendance + subs. ✅ DONE (merged, PR #227).**
  `/leagues/[id]/attendance` (`<BoxAttendanceManager>`), reached via the **Run
  Session** nav action (now format-aware — `lib/leagues/runSession.ts`
  `getRunSessionAction`). Mounts `<AttendanceGrid>` backed by `league_attendance`
  (`period_id` = active cycle) via the service-role admin client, box members
  grouped by box. Set status / add sub / assign sub routes under
  `/api/leagues/[id]/attendance`. Covered registration keeps the credit, so
  standings/promotion-relegation need no change. **v1 caveat:** attendance + subs
  operate at the **entrant** level (a team in doubles, a player in singles);
  per-individual-within-a-doubles-team subbing is a future refinement.

- **Phase 4 — Migrate round-robin onto `league_attendance`. ❌ NOT PURSUED (decision, July 3, 2026).**
  Evaluated and rejected as high-risk / low-reward. Round-robin's attendance lives
  on `league_session_players.actual_status`, and that table **is the lineup** —
  `league_round_matches` FK to `league_session_players.id`, and subs *and guests*
  each get a session-player row (guests have no `user_id` or registration). The
  unified `league_attendance` is keyed on registration/user/guest, with no
  session-player slot concept, so a migration would either pollute the generic
  table with an RR-specific `session_player_id` or break for guests (no `user_id`).
  Either way `league_session_players` must stay (match slots need it), leaving the
  status in **two tables to keep in sync** across organizer taps, self-check-in
  realtime, the offline queue, round-gen eligibility, and results crediting — real
  risk to the working scheduler, for storage uniformity **no current feature
  needs**. The unification goal is already met at the UI + model level (shared
  grid, resolver, six-status model; box on `league_attendance`). Revisit only if a
  concrete cross-format need appears (e.g. cross-league attendance history).

Phases 1–3 each shipped as their own PR.

---

## 5. Regression safety

- Phase 1 is a behavior-preserving refactor; the round-robin live page must look
  and act identically.
- `league_attendance` is additive; only box reads/writes it.
- Round-robin's live-session engine and scheduler were left untouched (Phase 4 not
  pursued), so its fairness/eligibility behavior is unchanged.
- Box tables (incl. `league_attendance`) are RLS deny-all + service-role, matching
  the established box pattern in the box API routes.

---

## 6. Open questions

- Should a sub's **own** participation be recorded anywhere (e.g. for the sub's
  match history), or stay fully transparent as today (credit only to the covered
  member)? v1: transparent, matching round-robin.
- Multi-night-per-cycle box play: deferred (see §3).
