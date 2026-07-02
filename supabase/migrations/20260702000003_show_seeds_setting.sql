-- Seed-number display: a tournament-level default (shown on brackets/schedules/
-- export) with an optional per-division override (null = inherit the tournament).
alter table tournaments
  add column if not exists show_seeds boolean not null default false;

alter table tournament_divisions
  add column if not exists show_seeds boolean;
