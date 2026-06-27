-- Up-front playoff brackets: a "+ playoffs" division's bracket is created as labeled
-- POSITION PLACEHOLDERS (1st vs 2nd, Pool 1 #1 vs Pool 2 #2, …) alongside the base
-- matches, so it's scheduled from the start. These columns record which standings
-- position fills a slot until the real team is seeded:
--   round robin → {"kind":"rank","rank":1,"label":"1st"}
--   pool play   → {"kind":"pool_rank","pool":1,"rank":2,"label":"Pool 1 #2"}
-- Null once a real team is set (when base play finishes and the bracket is seeded).
alter table tournament_matches
  add column if not exists team_1_source jsonb,
  add column if not exists team_2_source jsonb;
