-- Player-profile Phase 3: durable placement achievements (tournament champion / finalist /
-- podium), one row per (player, completed division). Populated by the nightly recompute
-- (full replace). RLS deny-all — read server-side via the service role.
create table if not exists player_achievements (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references profiles(id) on delete cascade,
  place int not null,
  tournament_id uuid,
  division_id uuid,
  tournament_name text,
  division_name text,
  earned_on date,
  created_at timestamptz not null default now(),
  unique (player_id, division_id)
);
create index if not exists player_achievements_player_idx on player_achievements (player_id);
alter table player_achievements enable row level security;
