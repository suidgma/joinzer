-- Player-profile résumé Phase 1: optional human/personality + preferred-play fields.
-- All nullable + additive — no backfill, existing rows unaffected.
alter table profiles
  add column if not exists bio text,
  add column if not exists dominant_hand text check (dominant_hand in ('left', 'right', 'ambidextrous')),
  add column if not exists preferred_side text check (preferred_side in ('left', 'right', 'either')),
  add column if not exists preferred_formats text[];
