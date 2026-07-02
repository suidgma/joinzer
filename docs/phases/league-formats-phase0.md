# League Formats — Phase 0 PR Breakdown

> ⚠️ **Design proposal, not current state.** Nothing here is built. Companion to `docs/phases/league-formats.md` (the architecture design).
> This doc breaks Phase 0 into PR-sized slices. Additive, backward-compatible, **zero change to current production behavior.**
> Last revised: July 2, 2026.

Phase 0 = four additive PRs. This doc fully specifies **PR-0.1**; 0.2–0.4 are summarized (full rationale in the parent design doc).

| PR | Title | Depends on |
|---|---|---|
| **0.1** | `format_kind` + `format_settings_json` on `leagues` | — |
| 0.2 | `league_fixtures` table (new, unused) | 0.1 |
| 0.3 | Shared standings core generalization + fixture adapter | 0.2 |
| 0.4 | Close league scoring gaps (audit / notify / validation / auth) | — (independent) |

---

## PR-0.1 — `format_kind` + `format_settings_json`

### Goal
Give every league a **format dimension** so later PRs can dispatch on it. Purely additive: existing + new leagues default to `'session_rr'` and behave exactly as today. **No reader branches on the new columns in this PR.**

### Scope
**In:**
- Two additive columns on `leagues`.
- Verify existing rows read back as `session_rr`.

**Explicitly out (later PRs):**
- Format strategy interface / dispatch (`lib/leagues/formats/`) — added when a *second* format exists to dispatch to (Box PR-1.x). An interface with one pass-through impl and no second caller is premature.
- `league_fixtures` (PR-0.2).
- Standings changes (PR-0.3).
- Any create/edit UI format picker (added with Box, when there's a real choice to offer).

### Schema (design — migration authored at build time, applied BEFORE code per the CLAUDE.md gotcha)
Proposed migration `supabase/migrations/2026070X000001_leagues_format_kind.sql`:

```sql
alter table leagues
  add column if not exists format_kind text not null default 'session_rr';

alter table leagues
  add column if not exists format_settings_json jsonb not null default '{}'::jsonb;

-- Include ALL future values now so no second migration is needed when Box/Flex/
-- Ladder/Team land. Additive check on an existing column with a safe default.
alter table leagues
  add constraint leagues_format_kind_check
  check (format_kind in ('session_rr','box','flex','ladder','team'));
```

- **Backfill:** none — the `default 'session_rr'` covers all existing rows.
- **Constraint choice:** enumerate all five kinds up front (avoids a follow-up `alter constraint` per format). If preferred, drop the CHECK entirely and enforce in app code — but the CHECK is cheap insurance and matches the tournament `bracket_type` precedent.

### Code changes
There is **no shared `League` type** in `lib/types.ts` and no single league loader — leagues are read ad-hoc via `.from('leagues').select(...)` in ~10 files (e.g. `app/(app)/leagues/[id]/page.tsx`, `.../standings/page.tsx`, `.../edit/EditLeagueForm.tsx`). So PR-0.1 touches almost nothing:

- **Write path:** rely on the DB default. `app/(app)/leagues/create/CreateLeagueForm.tsx` may *optionally* set `format_kind: 'session_rr'` explicitly in its insert for clarity, but it is not required (default handles it). **No UI change.**
- **Read path:** do **not** add the columns to any `select` yet — nothing reads them in 0.1. They get added to specific selects in 0.2+ where a reader needs them. (Deferring avoids touching 10 loaders for no benefit.)
- **Type:** if/when a shared league type is introduced later, add both fields there; not needed for 0.1.

### Verification
1. Apply migration via Supabase MCP `apply_migration`; `execute_sql`: `select format_kind, count(*) from leagues group by 1` → all existing rows `session_rr`.
2. Confirm `format_settings_json` defaults to `{}` on existing rows.
3. Create a new league through the app → row has `format_kind='session_rr'`, `format_settings_json='{}'`.
4. `npx tsc --noEmit` + `npx next build` clean (no code depends on the columns, so this is a formality).
5. **Behavior check:** an existing round-robin league's create → generate-round → score → standings flow is byte-for-byte unchanged (no reader touches the new columns).

### Risks & mitigations
- **Risk:** a stray `select('*')` somewhere surfaces the new columns into a typed shape. **Mitigation:** additive columns with defaults never break a `select('*')`; TS `any`-cast league reads are the norm here, so no type break.
- **Risk:** forgetting all future enum values → second migration later. **Mitigation:** enumerate all five now.
- **Risk:** scope creep into a strategy interface. **Mitigation:** explicitly deferred to Box.

### Rollback
Drop the two columns (safe — nothing reads them). No data loss beyond the (unused) format columns.

---

## PR-0.2 — `league_fixtures` table (summary)
New registration-based, tournament-shaped fixture table (columns in the parent design doc §3). Additive, **unused** until Box. FKs to `league_registrations`. No reader/writer in this PR beyond the migration + a `LeagueFixture` type.

## PR-0.3 — Shared standings core (summary)
Generalize `lib/tournament/standings.ts` `computeStandings` to accept an **entity key** (`entityOf(match, side)`) + a caller-filtered **scope**; add `lib/leagues/fixtureStandings.ts` adapter mapping `league_fixtures` → `StandingsMatchInput`. Tournament + existing league standings paths unchanged; only new fixture formats use the generalized entry.

## PR-0.4 — Close league scoring gaps (summary, independent)
Wire `lib/audit/log.ts` (`league_match` entity exists) + `lib/notifications/create.ts` (`league` surface exists) + a shared `validateScores` + explicit route auth into the league score path — mirroring `app/api/tournaments/[id]/matches/[matchId]/score/route.ts`. Ships value immediately and establishes the pattern the fixture score route reuses. Can land before or after 0.1–0.3.

---

## Sequencing within Phase 0
`0.1 → 0.2 → 0.3`, with `0.4` landing any time (independent). Box League (PR-1.x) starts once 0.1–0.3 are in. Recommended order keeps every step additive and independently verifiable with no production behavior change.
