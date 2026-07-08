-- Team League — Phase 0a: additive schema (tables + fixture columns).
-- Everything here is additive and nullable → Round Robin / Box / Ladder behavior is
-- unchanged. No enum/CHECK changes needed (leagues.format_kind already permits 'team';
-- league_periods.period_kind already permits 'matchday'). See docs/phases/team-league.md §4.

-- ── The team entity ──
create table if not exists public.league_teams (
  id                      uuid primary key default gen_random_uuid(),
  league_id               uuid not null references public.leagues(id) on delete cascade,
  name                    text not null,
  captain_registration_id uuid references public.league_registrations(id) on delete set null,
  seed                    integer,
  status                  text not null default 'active' check (status in ('active','withdrawn')),
  created_by              uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (league_id, name)
);
create index if not exists league_teams_league_idx on public.league_teams (league_id);

-- ── The roster ──
create table if not exists public.league_team_members (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.league_teams(id) on delete cascade,
  registration_id uuid not null references public.league_registrations(id) on delete cascade,
  role            text not null default 'member' check (role in ('captain','co_captain','member','sub')),
  created_at      timestamptz not null default now(),
  unique (team_id, registration_id)
);
create index if not exists league_team_members_team_idx on public.league_team_members (team_id);
create index if not exists league_team_members_registration_idx on public.league_team_members (registration_id);

-- ── RLS: deny-all (server via service role), mirroring league_boxes / league_fixtures ──
alter table public.league_teams enable row level security;
alter table public.league_team_members enable row level security;

-- ── Additions to league_fixtures (all nullable → additive) ──
-- Parents (match_stage='team_matchup') use team_*_id + winner_team_id.
-- Child doubles lines (match_stage='team_line') use team_*_partner_registration_id for the
-- ad-hoc 2nd player per side (mirrors tournament_matches rotating doubles).
alter table public.league_fixtures
  add column if not exists team_1_id                      uuid references public.league_teams(id) on delete cascade,
  add column if not exists team_2_id                      uuid references public.league_teams(id) on delete cascade,
  add column if not exists winner_team_id                 uuid references public.league_teams(id) on delete set null,
  add column if not exists team_1_partner_registration_id uuid references public.league_registrations(id) on delete set null,
  add column if not exists team_2_partner_registration_id uuid references public.league_registrations(id) on delete set null;

create index if not exists league_fixtures_team_1_idx on public.league_fixtures (team_1_id);
create index if not exists league_fixtures_team_2_idx on public.league_fixtures (team_2_id);
