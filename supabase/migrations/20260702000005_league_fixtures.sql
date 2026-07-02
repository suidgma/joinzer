-- League fixtures (Phase 0, PR-0.2). A registration-based, tournament-shaped
-- matchup row that the box/flex/team formats will generate and score. Mirrors
-- the relevant tournament_matches columns so the pure generators
-- (poolPlayMatches, roundRobinMatches) and computeStandings reuse with
-- near-zero adaptation.
--
-- Unlike league_matches (ephemeral player-slot combinations, no stable entrant,
-- no winner column), a fixture is between STABLE entrants (league_registrations)
-- and carries its own result/status/window.
--
-- Additive + UNUSED: no code reads or writes this table yet. The current
-- session-based round-robin path (league_rounds / league_round_matches /
-- league_matches) is untouched.

create table if not exists league_fixtures (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,

  -- Period / box association. Plain uuid for now — league_periods and
  -- league_boxes don't exist until the Box PR, which adds the FK constraints.
  period_id uuid,
  box_id uuid,

  -- Ordering, straight from the generators.
  round_number int,
  match_number int not null default 1,
  match_stage text not null default 'round_robin',

  -- Stable entrants (FK to league_registrations, not player ids).
  team_1_registration_id uuid references league_registrations(id) on delete set null,
  team_2_registration_id uuid references league_registrations(id) on delete set null,

  -- Result.
  team_1_score int,
  team_2_score int,
  winner_registration_id uuid references league_registrations(id) on delete set null,
  status text not null default 'scheduled'
    check (status in ('scheduled','in_progress','completed','forfeited','disputed','cancelled')),

  -- Optional placement (timed play).
  court_number int,
  scheduled_time timestamptz,

  -- Optional match window (flex self-scheduling, ladder challenge windows).
  window_start timestamptz,
  window_end timestamptz,

  -- Flex self-report / confirm.
  reported_by uuid references auth.users(id) on delete set null,
  confirmed_by uuid references auth.users(id) on delete set null,

  -- Team-league nested matches (future): child fixtures under a team matchup.
  parent_fixture_id uuid references league_fixtures(id) on delete cascade,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists league_fixtures_league_status_idx on league_fixtures (league_id, status);
create index if not exists league_fixtures_box_idx on league_fixtures (box_id) where box_id is not null;
create index if not exists league_fixtures_period_idx on league_fixtures (period_id) where period_id is not null;
create index if not exists league_fixtures_parent_idx on league_fixtures (parent_fixture_id) where parent_fixture_id is not null;
create index if not exists league_fixtures_team1_idx on league_fixtures (team_1_registration_id);
create index if not exists league_fixtures_team2_idx on league_fixtures (team_2_registration_id);

-- RLS on by default (security.md: every table, no exception). No policies yet →
-- deny-all to anon/authenticated clients; server-side generation/scoring runs
-- through the service role (which bypasses RLS), matching the tournament match
-- flow. Scoped SELECT policies (participants + organizer) land with the first
-- reader PR (Box standings).
alter table league_fixtures enable row level security;
