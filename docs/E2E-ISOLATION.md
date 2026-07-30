E2E Isolation
=============

Status: **blocked on a decision** (2026-07-29). The Supabase-branch approach in the
original draft of this doc was tried and failed. This file records why, what was
proven, and what the real options are. Do not follow the old branch instructions.

The problem
-----------
Playwright writes to the **production** database. `.env.test` carries only test-user
credentials — there is no separate Supabase project. The leak is active, not
historical: as of 2026-07-29 production contains

| table | row | created |
|---|---|---|
| `tournaments` | `Playwright Test Tournament` | 2026-07-29 15:17 UTC |
| `events` | `Playwright Test Session` | 2026-05-13 01:42 UTC |
| `events` | `Playwright Test Session` | 2026-05-13 01:37 UTC |

What was tried
--------------
An `e2e` Supabase branch was created (2026-07-29 18:11 UTC, ref `zohzxntwzwshvjjkifcl`).
It came up **MIGRATIONS_FAILED** and was deleted the same day to stop the hourly meter.

Failure point — migration `20260609200537 relax_games_to_constraints`:

```
execute: ALTER TABLE tournaments
  ADD CONSTRAINT tournaments_default_games_to_check
  CHECK (default_games_to IS NULL OR default_games_to >= 1)
ERROR: column "default_games_to" does not exist
```

`default_games_to` is added by `supabase/migrations/20260604000003_tournament_more_defaults.sql`
— a file that is **not in production's migration ledger**. Branch creation replays the
ledger, not the folder, so the column was never created and the constraint blew up.

The root cause: the folder and the ledger have diverged
-------------------------------------------------------
This is not a one-migration problem. Comparing `supabase/migrations/` against
`supabase_migrations.schema_migrations` on `gkbibpneusfnwkjedwbi`:

| measure | files | ledger |
|---|---|---|
| total entries | 138 | 170 |
| **matched by version** | **4** | |
| matched by name | 118 | |

Two version-stamping schemes were used in parallel. Repo files are hand-numbered
(`20260604000003` — date + counter); ledger entries carry real wall-clock stamps
(`20260609200537`) because they were applied via `apply_migration` / the dashboard
rather than from the folder. Same migrations, different identities — so the ledger
recognizes almost nothing in the folder.

Consequences, in order of severity:

1. **52 migrations applied to production have no file of that name in the repo.**
   Production's schema cannot be reproduced from `supabase/migrations/`. Includes
   real schema changes — `tournaments_rebuild`, `create_tournament_matches`,
   `tournament_staff_and_stripe_connect`, `add_lat_lng_to_locations`,
   `harden_tournament_child_table_rls`, `address_source_provenance`, and 46 more.
2. **Every future Supabase branch will fail the same way** until this is reconciled.
   Branching is unusable, not merely broken once.
3. **21 files exist whose names never appear in the ledger.** Some are superseded
   scaffolding (`schema`, `rls`, `rpcs`, `tournaments`, `tournament_divisions`), but
   others are not obviously dead (`email_log`, `gender_validation_rpcs`,
   `drop_skill_level_columns`, `sync_partner_columns`) and need triage.

Production itself is healthy. What is broken is **reproducibility** — the ability to
stand up a second copy of this schema anywhere, for any reason.

Why "just run it locally" is not a drop-in
------------------------------------------
Building a local stack from `supabase/migrations/` produces a schema missing those
52 migrations. It would not match production, so tests passing against it would prove
little. Any path forward needs a **true baseline captured from production first**
(`supabase db pull` / `db dump`), adopted as the new source of truth, with the 138
legacy files archived.

Also, on this machine as of 2026-07-29:

- Supabase CLI — available via `npx supabase` (2.110.0) ✅
- Docker — **not installed** ❌ (`supabase start` requires it)
- `supabase/config.toml` — **absent**; the repo has never been linked for local dev

The options
-----------

**A — Local stack.** Install Docker Desktop, `supabase db pull` a true baseline, run
Playwright against `supabase start`. $0/month recurring, fully isolated, no production
exposure. Costs a Docker Desktop install (WSL2 on Windows Home) and the baseline work.

**B — Fix the ledger, go back to branches.** Same `db pull` baseline, then branches
build correctly. ~$9.68/month while a branch runs ($0.01344/hr), near-zero only with
strict pause discipline. No Docker needed.

**C — Stay on production, isolate by data.** Namespace every test row and clean up
after each run. Note `leagues` and `tournaments` already carry a `dummy` flag
(ledger: `add_is_test_flag_to_leagues_and_tournaments` →
`rename_is_test_to_dummy_on_leagues_and_tournaments`). Cheapest and needs nothing new,
but it is not isolation — a bad run still writes to production.

A and B share the same prerequisite: capture a real baseline from production. That
step is read-only against prod and is worth doing regardless of which option wins.

Blocked on
----------
- **A** needs Docker Desktop installed.
- **A and B** need `supabase db pull`, which requires linking the project — a database
  password or `SUPABASE_ACCESS_TOKEN`. Owner-supplied; not available to agents
  (`.env*` is deny-listed for reads).

Sequencing note
---------------
Deleting the three production test rows must come **last**, after e2e is repointed.
Delete them first and the next `npm test` simply recreates them.

Open items in the working tree
------------------------------
Uncommitted as of this writing: `playwright.config.ts` (1 line),
`lib/tournament/__tests__/generate-matches-logic.test.ts` (fixture-provenance comment,
the `staging` branch it referenced is now deleted), `scripts/set-e2e-env.js` (helper
that rewrites `.env.test` — written for the abandoned branch approach, still usable
for any URL/key pair).

Done already
------------
- `vitest.config.ts` ships alone with include-by-convention — merged as `2a52efa` (#474)
- `staging` branch deleted
- `e2e` branch created, failed, deleted — meter stopped
