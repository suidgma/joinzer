-- Unified attendance (docs/phases/unified-attendance.md, Phase 2). Additive +
-- UNUSED — no reader/writer yet. One format-agnostic attendance table keyed on a
-- play occasion (a round-robin session OR a box/flex/etc. period) and an attendee
-- (a registration, or an ad-hoc guest). A substitute is an attendee row whose
-- subbing_for_registration_id points at the covered roster member; the covered
-- member's row is 'has_sub'. Credit stays on the covered registration.

create table if not exists league_attendance (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,

  -- play occasion: exactly one of these is set (see check below)
  session_id uuid references league_sessions(id) on delete cascade,   -- round-robin
  period_id  uuid references league_periods(id)  on delete cascade,   -- box / flex / ladder / team

  -- attendee: a registration (roster member) and/or a known profile, or a guest
  registration_id uuid references league_registrations(id) on delete cascade,
  user_id         uuid references profiles(id)             on delete set null,
  guest_name      text,

  -- state — same six values as the round-robin grid
  status text not null default 'not_present'
    check (status in ('present','coming','late','cannot_attend','has_sub','not_present')),
  -- when this attendee covers an absent roster member (credit flows to that registration)
  subbing_for_registration_id uuid references league_registrations(id) on delete cascade,
  arrived_after_round int,
  checked_in_at timestamptz,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint league_attendance_one_occasion check (
    (session_id is not null)::int + (period_id is not null)::int = 1
  ),
  constraint league_attendance_attendee check (
    registration_id is not null or guest_name is not null
  )
);

-- One attendance row per (occasion, registration). Guests (no registration) are
-- identified by row id, so they are excluded from the uniqueness.
create unique index if not exists league_attendance_period_reg_uq
  on league_attendance (period_id, registration_id)
  where period_id is not null and registration_id is not null;
create unique index if not exists league_attendance_session_reg_uq
  on league_attendance (session_id, registration_id)
  where session_id is not null and registration_id is not null;

create index if not exists league_attendance_league_idx  on league_attendance (league_id);
create index if not exists league_attendance_period_idx   on league_attendance (period_id);
create index if not exists league_attendance_session_idx  on league_attendance (session_id);
create index if not exists league_attendance_reg_idx      on league_attendance (registration_id);

-- RLS on by default (security.md). No policies yet → deny-all to client roles;
-- server access goes through the service role. Scoped SELECT policies land with
-- the reader phases.
alter table league_attendance enable row level security;
