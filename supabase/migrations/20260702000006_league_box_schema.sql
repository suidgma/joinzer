-- Box League schema (Phase 1, PR-1.1). Additive + UNUSED — no reader/writer yet,
-- not wired into format_kind dispatch. Adds the cycle/box grouping tables and
-- wires the FK constraints deferred on league_fixtures in PR-0.2.
--
-- league_periods is the generic competition-period table (docs/phases/
-- league-formats.md §4): Box uses period_kind='cycle'; Flex/Team reuse it later
-- ('window'/'matchday').

create table if not exists league_periods (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  period_kind text not null default 'cycle'
    check (period_kind in ('cycle','window','matchday')),
  period_number int not null,
  name text,
  starts_on date,
  ends_on date,
  status text not null default 'upcoming'
    check (status in ('upcoming','active','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, period_kind, period_number)
);

create table if not exists league_boxes (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references league_periods(id) on delete cascade,
  league_id uuid not null references leagues(id) on delete cascade,   -- denormalized for scoping/RLS
  name text,
  tier_rank int not null,           -- 1 = top box
  box_size int,
  status text not null default 'active' check (status in ('active','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_id, tier_rank)
);

create table if not exists league_box_members (
  id uuid primary key default gen_random_uuid(),
  box_id uuid not null references league_boxes(id) on delete cascade,
  registration_id uuid not null references league_registrations(id) on delete cascade,
  seed_in_box int,
  created_at timestamptz not null default now(),
  unique (box_id, registration_id)
);

create index if not exists league_periods_league_idx on league_periods (league_id);
create index if not exists league_boxes_period_idx on league_boxes (period_id);
create index if not exists league_boxes_league_idx on league_boxes (league_id);
create index if not exists league_box_members_box_idx on league_box_members (box_id);
create index if not exists league_box_members_reg_idx on league_box_members (registration_id);

-- Wire the FK constraints PR-0.2 deferred on league_fixtures (empty table → safe).
-- Guarded so re-application is idempotent. on delete set null (not cascade) — box
-- regeneration deletes its fixtures explicitly, mirroring tournament regen.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'league_fixtures_period_fk') then
    alter table league_fixtures add constraint league_fixtures_period_fk
      foreign key (period_id) references league_periods(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'league_fixtures_box_fk') then
    alter table league_fixtures add constraint league_fixtures_box_fk
      foreign key (box_id) references league_boxes(id) on delete set null;
  end if;
end $$;

-- RLS on by default (security.md). No policies yet → deny-all to client roles;
-- server writes go through the service role. Scoped SELECT policies land with the
-- Box standings reader (PR-1.5).
alter table league_periods enable row level security;
alter table league_boxes enable row level security;
alter table league_box_members enable row level security;
