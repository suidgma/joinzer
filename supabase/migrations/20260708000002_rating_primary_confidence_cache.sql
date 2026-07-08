-- Phase 2 slice 5: extend the profiles rating cache so the UI can decide what to show
-- (Score at Established) without reading the RLS-locked player_ratings table.
alter table public.profiles
  add column if not exists primary_confidence text,
  add column if not exists primary_games integer;
