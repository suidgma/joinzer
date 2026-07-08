-- Phase 2 slice 4: calculated-rating storage. Additive. player_ratings is the engine's
-- source of truth (RLS deny-all, service-role writes); profiles gains a public cache.
-- See docs/phases/rating-engine-phase2.md §6.

create table if not exists public.player_ratings (
  player_id         uuid not null references public.profiles(id) on delete cascade,
  activity          text not null default 'pickleball',
  format            text not null,                       -- 'doubles' | 'singles'
  internal_rating   numeric not null,                    -- Glicko-2 rating (private)
  rating_rd         numeric not null,
  rating_volatility numeric not null,
  joinzer_score     integer not null,                    -- 0–100 public cache
  games_counted     integer not null default 0,
  events_counted    integer not null default 0,          -- distinct sessions/tournaments
  basis             text not null default 'calculated',  -- 'seed' | 'calculated'
  confidence_state  text not null default 'provisional', -- 'provisional' | 'established' | 'rusty'
  last_played_at    timestamptz,
  updated_at        timestamptz not null default now(),
  primary key (player_id, activity, format)
);

create index if not exists player_ratings_score_idx
  on public.player_ratings (activity, format, joinzer_score desc);

alter table public.player_ratings enable row level security;
-- No policies: deny-all to clients; server writes via service role. Mirrors box/ladder tables.

-- Public cache on profiles (cheap directory/profile reads; primary = doubles by default).
alter table public.profiles
  add column if not exists primary_activity text default 'pickleball',
  add column if not exists primary_format text,
  add column if not exists primary_joinzer_score integer,
  add column if not exists primary_joinzer_level text;
