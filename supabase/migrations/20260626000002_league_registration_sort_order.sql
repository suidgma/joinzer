-- Manual roster ordering for leagues. Organizers can drag-reorder the roster;
-- the position is stored here. Null = unordered (falls back to registered_at).
-- This is display order only — leagues don't seed brackets.
alter table league_registrations
  add column if not exists sort_order int;
