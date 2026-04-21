-- Migration 001: Initial schema
-- All tables follow CLAUDE.md §5 amendments:
--   - profiles replaces users (no password_hash; keyed by auth.users)
--   - starts_at timestamptz replaces event_date + start_time
--   - access_type is text + check constraint (not enum) for easy extensibility
--   - explicit on delete behavior on all FK columns

-- ─── profiles ────────────────────────────────────────────────────────────────
create table profiles (
  id                uuid        primary key references auth.users(id) on delete cascade,
  name              text        not null,
  email             text,
  profile_photo_url text,
  phone             text,
  dupr_rating       decimal(4,2),
  estimated_rating  decimal(4,2),
  rating_source     text        check (rating_source in ('dupr_known', 'estimated', 'skipped')),
  created_at        timestamptz not null default now()
);

-- ─── locations ───────────────────────────────────────────────────────────────
create table locations (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null,
  metro_area   text        not null default 'Las Vegas',
  subarea      text,
  court_count  int         not null default 1,
  access_type  text        not null check (access_type in (
                             'public', 'private', 'resort', 'fee_based',
                             'business', 'directory', 'hoa', 'indoor_public', 'semi_private'
                           )),
  notes        text,
  is_active    boolean     not null default true
);

create index idx_locations_court_count on locations (court_count desc, name asc);

-- ─── events ──────────────────────────────────────────────────────────────────
create table events (
  id                uuid        primary key default gen_random_uuid(),
  title             text        not null,
  creator_user_id   uuid        not null references profiles(id) on delete restrict,
  captain_user_id   uuid        not null references profiles(id) on delete restrict,
  location_id       uuid        not null references locations(id) on delete restrict,
  starts_at         timestamptz not null,
  duration_minutes  int         not null default 120,
  court_count       int         not null default 1,
  players_per_court int         not null default 6,
  max_players       int         not null,
  notes             text,
  status            text        not null default 'open'
                                check (status in ('open', 'full', 'cancelled', 'completed')),
  created_at        timestamptz not null default now()
);

create index idx_events_starts_at   on events (starts_at);
create index idx_events_status      on events (status);
create index idx_events_location_id on events (location_id);

-- ─── event_participants ───────────────────────────────────────────────────────
-- unique(event_id, user_id): one row per user per event; join_event RPC updates
-- the row rather than inserting a second one when a user re-joins after leaving.
create table event_participants (
  id                 uuid        primary key default gen_random_uuid(),
  event_id           uuid        not null references events(id) on delete cascade,
  user_id            uuid        not null references profiles(id) on delete cascade,
  participant_status text        not null
                                 check (participant_status in ('joined', 'waitlist', 'left')),
  joined_at          timestamptz not null default now(),
  unique (event_id, user_id)
);

create index idx_event_participants_event_id on event_participants (event_id);
create index idx_event_participants_user_id  on event_participants (user_id);

-- ─── event_messages ──────────────────────────────────────────────────────────
create table event_messages (
  id           uuid        primary key default gen_random_uuid(),
  event_id     uuid        not null references events(id) on delete cascade,
  user_id      uuid        not null references profiles(id) on delete cascade,
  message_text text        not null,
  created_at   timestamptz not null default now()
);

create index idx_event_messages_event_id on event_messages (event_id, created_at);
