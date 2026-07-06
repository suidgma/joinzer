-- Ladder League (king-of-the-court / up-down). Additive: a continuous per-league
-- ranking + trend history. Sessions reuse league_periods (period_kind
-- 'ladder_session'); per-court games reuse league_fixtures (round_number +
-- court_number). Only the ranking state is new. Applied to prod via MCP.

-- 1. Allow ladder sessions as periods.
alter table league_periods drop constraint if exists league_periods_period_kind_check;
alter table league_periods add constraint league_periods_period_kind_check
  check (period_kind in ('cycle','window','matchday','ladder_session'));

-- 2. Continuous ranking (one row per entrant: a singles reg or a doubles canonical reg).
create table if not exists ladder_positions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  registration_id uuid not null references league_registrations(id) on delete cascade,
  position int not null,
  updated_at timestamptz not null default now(),
  unique (league_id, registration_id)
);
create index if not exists ladder_positions_league_pos_idx on ladder_positions (league_id, position);

-- 3. Ranking history for trend / prior-rank / delta (one row per entrant per finalized session).
create table if not exists ladder_position_history (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  period_id uuid references league_periods(id) on delete set null,
  registration_id uuid not null references league_registrations(id) on delete cascade,
  session_number int,
  position_before int,
  position_after int,
  wins int not null default 0,
  losses int not null default 0,
  pf int not null default 0,
  pa int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ladder_position_history_entrant_idx
  on ladder_position_history (league_id, registration_id, session_number);

-- 4. RLS: deny-all; server reads/writes via service role (mirrors box tables).
alter table ladder_positions enable row level security;
alter table ladder_position_history enable row level security;
