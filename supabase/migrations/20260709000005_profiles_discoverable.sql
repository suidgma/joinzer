-- Player directory privacy opt-out. When false, the player is hidden from the
-- Players directory and their public profile page is visible to themselves only.
-- Defaults to true so every existing player stays discoverable (no behavior change).
alter table profiles
  add column if not exists discoverable boolean not null default true;
