-- Advanced Schedule Builder — Slice 1: data model only (additive, zero behavior change).
-- Lets organizers define date/time/court "blocks", assign divisions to them, and
-- generate a draft match schedule that can be previewed before publishing.

-- 1. Schedule blocks: a named date + time window + set of courts at a venue.
create table tournament_schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  block_date date not null,
  start_time time not null,
  end_time time not null,
  location_id uuid references locations(id),
  court_numbers int[] not null default '{}'::int[],
  notes text,
  priority int not null default 0,
  max_divisions int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);

alter table tournament_schedule_blocks enable row level security;

-- Planning data: organizer-only via the anon/auth client. Server routes use the
-- service_role client (bypasses RLS), so co-organizer authorization is enforced in code.
create policy "schedule_blocks_organizer_all"
  on tournament_schedule_blocks for all
  using (exists (select 1 from tournaments t where t.id = tournament_id and t.organizer_id = auth.uid()))
  with check (exists (select 1 from tournaments t where t.id = tournament_id and t.organizer_id = auth.uid()));

create index tournament_schedule_blocks_tournament
  on tournament_schedule_blocks(tournament_id, block_date, start_time);

-- 2. Division ⇄ block assignment. M2M-capable so a division can later span
-- multiple blocks (pool play vs playoffs); the MVP UI enforces one block per division.
create table tournament_division_blocks (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  division_id uuid not null references tournament_divisions(id) on delete cascade,
  block_id uuid not null references tournament_schedule_blocks(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (division_id, block_id)
);

alter table tournament_division_blocks enable row level security;

create policy "division_blocks_organizer_all"
  on tournament_division_blocks for all
  using (exists (select 1 from tournaments t where t.id = tournament_id and t.organizer_id = auth.uid()))
  with check (exists (select 1 from tournaments t where t.id = tournament_id and t.organizer_id = auth.uid()));

create index tournament_division_blocks_block on tournament_division_blocks(block_id);
create index tournament_division_blocks_division on tournament_division_blocks(division_id);

-- 3. Tournament-level scheduling settings (1:1). jsonb to match the existing
-- format_settings_json convention; sensible defaults baked in.
alter table tournaments
  add column if not exists schedule_settings_json jsonb not null default '{
    "match_duration_minutes": 25,
    "buffer_minutes": 5,
    "min_rest_minutes": 10,
    "conflict_policy": "warning",
    "keep_divisions_grouped": true,
    "allow_division_overlap": true,
    "leave_end_buffer": false,
    "end_buffer_minutes": 0
  }'::jsonb;

-- 4. Match columns: which block a match belongs to, and whether it's still a draft.
-- on delete set null: deleting a block unlinks its matches rather than deleting them.
alter table tournament_matches
  add column if not exists schedule_block_id uuid references tournament_schedule_blocks(id) on delete set null;

-- Drafts are hidden from participant/live/standings views until published (Slice 4).
-- Defaults false so every existing row stays live exactly as today.
alter table tournament_matches
  add column if not exists is_draft boolean not null default false;

create index tournament_matches_tournament_draft on tournament_matches(tournament_id, is_draft);
