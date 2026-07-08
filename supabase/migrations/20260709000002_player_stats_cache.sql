-- Player-profile Phase 2: per-player competitive career-stats cache, populated by the
-- nightly recompute cron (same pass that builds player_ratings). Whole PlayerStats stored
-- as jsonb (regenerated each run). RLS deny-all — read server-side via the service role,
-- mirroring player_ratings. Profiles fall back to compute-on-read when a row is missing.
create table if not exists player_stats (
  player_id uuid primary key references profiles(id) on delete cascade,
  stats jsonb not null,
  updated_at timestamptz not null default now()
);
alter table player_stats enable row level security;
