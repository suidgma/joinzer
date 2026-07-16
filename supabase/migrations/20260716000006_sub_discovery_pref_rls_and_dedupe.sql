-- Phase 4: substitute discovery — opt-in preference, RLS tightening, proactive-notification dedupe,
-- and query indexes. (docs/phases/substitutions-implementation-plan.md §4.1, §6.)
--
-- Additive + safe on a fresh chain and on the current prod Phase-3 state.

-- ── 1. Opt-in preference (default OFF — never silently enable proactive surfacing) ───────────────
alter table public.profiles
  add column if not exists open_to_subbing boolean not null default false;

comment on column public.profiles.open_to_subbing is
  'MVP opt-in: when true, eligible substitute opportunities may appear on Home and the user may get '
  'proactive "league needs a sub" notifications. Does NOT gate /subs browsing (every eligible player '
  'can browse) nor the user''s own request/filled statuses. Default false.';

-- ── 2. Narrow dedupe log for proactive substitute notifications ──────────────────────────────────
-- The notifications table has no metadata/key column, so a per-(request,user) unique row is the
-- reliable dedupe: "we already told this user about this request." Deny-all RLS (service role only);
-- specific to substitution notifications — NOT a generic action-items table.
create table if not exists public.sub_request_notifications (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.league_sub_requests(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (request_id, user_id)
);
alter table public.sub_request_notifications enable row level security;
comment on table public.sub_request_notifications is
  'Dedupe log for proactive substitute-opportunity notifications: one row per (request, notified user). '
  'Deny-all RLS; written only by the server (service role). Prevents re-notifying the same user for the '
  'same open request.';

-- ── 3. Tighten league_sub_requests SELECT — clients see only their OWN requests + ones they filled.
-- The open pool + organizer views are served by SERVER-SIDE loaders using the service role (which
-- bypasses RLS). This is more private (a sub request reveals an absence) and matches the deny-all model.
drop policy if exists lsr_read on public.league_sub_requests;
create policy lsr_read_own on public.league_sub_requests
  for select using (
    requesting_player_id = (select auth.uid())
    or filled_by_user_id = (select auth.uid())
  );

-- ── 4. Narrow query indexes for the discovery loaders ────────────────────────────────────────────
-- Open-pool scan (the /subs + Home matched loader): all open, unexpired requests newest-first.
create index if not exists league_sub_requests_open_pool_idx
  on public.league_sub_requests (created_at desc)
  where status = 'open';

-- The user's own requests (My requests view + Home own-request items).
create index if not exists league_sub_requests_requester_status_idx
  on public.league_sub_requests (requesting_player_id, status);
