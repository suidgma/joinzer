-- Unified "player nominates their own substitute" across Play / Leagues / Tournaments.
-- A player picks an existing Joinzer user; the nomination stays PENDING until the
-- organizer (captain / league admin / tournament organizer) approves it, at which
-- point the surface-specific effect runs (play + tournament = transfer the spot;
-- league = a real per-session sub that keeps the covered player's credit).
--
-- Deny-all RLS: touched only by server routes via the service role (the route is
-- the authorization boundary). One set of scope columns is populated per surface.
create table public.sub_nominations (
  id                        uuid primary key default gen_random_uuid(),
  surface                   text not null check (surface in ('play','league','tournament')),
  status                    text not null default 'pending'
                              check (status in ('pending','approved','declined','cancelled')),
  requesting_user_id        uuid not null references public.profiles(id) on delete cascade,
  nominated_user_id         uuid not null references public.profiles(id) on delete cascade,
  note                      text,

  -- Play scope
  event_id                  uuid references public.events(id) on delete cascade,

  -- League scope (session XOR period, plus the covered registration)
  league_id                 uuid references public.leagues(id) on delete cascade,
  league_session_id         uuid,
  league_period_id          uuid,
  covered_registration_id   uuid,

  -- Tournament scope
  tournament_id             uuid references public.tournaments(id) on delete cascade,
  tournament_registration_id uuid,

  resolved_by               uuid references public.profiles(id),
  resolved_at               timestamptz,
  created_at                timestamptz not null default now(),

  check (requesting_user_id <> nominated_user_id)
);

-- Fast lookups: pending nominations for an organizer's inbox + a player's own state.
create index sub_nominations_event_idx on public.sub_nominations (event_id) where event_id is not null;
create index sub_nominations_league_idx on public.sub_nominations (league_id) where league_id is not null;
create index sub_nominations_tournament_idx on public.sub_nominations (tournament_id) where tournament_id is not null;
create index sub_nominations_requester_idx on public.sub_nominations (requesting_user_id);

-- At most one active (pending) nomination per requester per scope.
create unique index sub_nominations_one_pending_play
  on public.sub_nominations (event_id, requesting_user_id) where surface = 'play' and status = 'pending';
create unique index sub_nominations_one_pending_tournament
  on public.sub_nominations (tournament_registration_id, requesting_user_id) where surface = 'tournament' and status = 'pending';

alter table public.sub_nominations enable row level security;
-- No policies: deny-all. All access is server-side via the service role.
