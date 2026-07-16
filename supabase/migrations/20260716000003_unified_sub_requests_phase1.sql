-- Phase 1: Unified league substitute domain (docs/phases/substitutions-implementation-plan.md).
-- league_sub_requests becomes the single league substitute-request model. This migration is
-- SCHEMA + DATA only — no acceptance/placement behavior (that is Phase 2's atomic RPC).
--
-- Extends the table with:
--   * period scope (box/ladder) alongside session scope (round-robin); exactly one set (XOR)
--   * final status set: open | filled | cancelled | expired  (drops dead claimed/approved/fulfilled)
--   * fulfillment_mode (open_pool | self_assigned | organizer_assigned)
--   * filled / expiry / cancellation / override metadata for future phases
--   * dedupe: at most one ACTIVE (open) request per covered player per occasion
--
-- Data migration is deterministic and preserves history (rows are re-stated, never deleted).
-- sub_nominations (Play + tournament + league) is NOT modified here; only its misleading table
-- comment is corrected. Existing substitute placement linkage
-- (league_session_players.sub_for_session_player_id / league_attendance.subbing_for_registration_id)
-- and leagues.sub_credit_cap are untouched.
--
-- Safe on a FRESH db (the UPDATEs match no rows; constraints/indexes create on an empty table) and
-- on the EXISTING db (all live rows are session-scoped 'open', which satisfy every new constraint).

-- ── 1. New columns (additive) ────────────────────────────────────────────────
alter table public.league_sub_requests
  add column if not exists league_period_id        uuid references public.league_periods(id) on delete cascade,
  add column if not exists covered_registration_id uuid references public.league_registrations(id) on delete set null,
  add column if not exists fulfillment_mode         text not null default 'open_pool',
  add column if not exists filled_by_user_id        uuid references public.profiles(id),
  add column if not exists filled_at                timestamptz,
  add column if not exists expires_at               timestamptz,
  add column if not exists cancelled_at             timestamptz,
  add column if not exists cancelled_by_user_id     uuid references public.profiles(id),
  add column if not exists placed_with_override     boolean not null default false,
  add column if not exists format                   text,
  add column if not exists gender_required          text;

-- ── 2. Period-scoped rows need a nullable session id (session XOR period) ─────
alter table public.league_sub_requests alter column league_session_id drop not null;

-- ── 3. Data migration (deterministic; history preserved) ─────────────────────
-- 3a. Dead coordination states (claimed/approved/fulfilled) NEVER placed a substitute in the old
--     system, so they must not read as 'filled'. Re-state them as 'cancelled'; the legacy
--     claimed_by_user_id / approved_by_user_id columns are RETAINED so the history is not lost.
update public.league_sub_requests
   set status = 'cancelled',
       cancelled_at = coalesce(cancelled_at, now())
 where status in ('claimed', 'approved', 'fulfilled');

-- 3b. Stale 'open' requests whose session has already passed → 'expired' (Pacific date).
update public.league_sub_requests r
   set status = 'expired'
  from public.league_sessions s
 where r.status = 'open'
   and r.league_session_id = s.id
   and s.session_date < (now() at time zone 'America/Los_Angeles')::date;

-- 3c. De-duplicate any remaining 'open' rows per (occasion, requester): keep the newest, cancel the
--     rest — belt-and-suspenders before the partial-unique indexes below.
with ranked as (
  select id,
         row_number() over (
           partition by coalesce(league_session_id::text, league_period_id::text), requesting_player_id
           order by created_at desc, id desc
         ) as rn
    from public.league_sub_requests
   where status = 'open'
)
update public.league_sub_requests r
   set status = 'cancelled',
       cancelled_at = coalesce(r.cancelled_at, now())
  from ranked
 where r.id = ranked.id
   and ranked.rn > 1;

-- 3d. All pre-existing requests were open-pool style.
update public.league_sub_requests set fulfillment_mode = 'open_pool' where fulfillment_mode is null;

-- ── 4. Constraints (added AFTER the data migration so every row satisfies them) ─
-- 4a. Final status set.
alter table public.league_sub_requests drop constraint if exists league_sub_requests_status_check;
alter table public.league_sub_requests
  add constraint league_sub_requests_status_check
  check (status in ('open', 'filled', 'cancelled', 'expired'));

-- 4b. Exactly one scope: session XOR period.
alter table public.league_sub_requests drop constraint if exists league_sub_requests_scope_xor;
alter table public.league_sub_requests
  add constraint league_sub_requests_scope_xor
  check ((league_session_id is not null) <> (league_period_id is not null));

-- 4c. Fulfillment mode enum.
alter table public.league_sub_requests drop constraint if exists league_sub_requests_fulfillment_mode_check;
alter table public.league_sub_requests
  add constraint league_sub_requests_fulfillment_mode_check
  check (fulfillment_mode in ('open_pool', 'self_assigned', 'organizer_assigned'));

-- ── 5. Indexes: dedupe (one active open per covered player per occasion) + query paths ─
create unique index if not exists league_sub_requests_one_open_per_session
  on public.league_sub_requests (league_session_id, requesting_player_id)
  where status = 'open' and league_session_id is not null;

create unique index if not exists league_sub_requests_one_open_per_period
  on public.league_sub_requests (league_period_id, requesting_player_id)
  where status = 'open' and league_period_id is not null;

create index if not exists league_sub_requests_league_status_idx
  on public.league_sub_requests (league_id, status);

create index if not exists league_sub_requests_filled_by_idx
  on public.league_sub_requests (filled_by_user_id)
  where status = 'filled';

-- ── 6. RLS: writes are service-role only. Drop the unused client-insert policy (the POST route
--     already inserts via the service role). Keep lsr_read (USING true) — the league page + Home
--     read the open pool via the USER client and depend on it; tightening SELECT is deferred to a
--     later phase when those reads move to server-side matched loaders. ─────────
drop policy if exists lsr_insert_own on public.league_sub_requests;

-- ── 7. Documentation: correct the misleading sub_nominations intent + document the unified table ─
comment on table public.league_sub_requests is
  'Unified LEAGUE substitute-request model (Phase 1). Scope = league_session_id (round-robin) XOR '
  'league_period_id (box/ladder). Statuses: open|filled|cancelled|expired. fulfillment_mode: '
  'open_pool | self_assigned | organizer_assigned. On accept (Phase 2, atomic RPC) filled_by_user_id '
  'is set and the substitute is PLACED in the same transaction via the existing linkage '
  '(league_session_players.sub_for_session_player_id / league_attendance.subbing_for_registration_id); '
  'leagues.sub_credit_cap continues to apply through that linkage. Legacy claimed_by_user_id / '
  'approved_by_user_id are retained for history and no longer written.';

comment on table public.sub_nominations is
  'Player-picks-own-substitute for the Play + tournament surfaces. NOTE: despite an earlier code '
  'comment claiming nominations "stay pending until the organizer approves", POST actually creates '
  'status=''approved'' and applies the placement IMMEDIATELY (no pending/approval step is used). '
  'League-surface nominations are being consolidated onto league_sub_requests '
  '(fulfillment_mode=''self_assigned''); Play + tournament remain here until their own phase.';
