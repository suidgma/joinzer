-- Manual pool assignment for pool-play divisions. When set, generate-matches
-- places this registration's team into the given pool instead of the default
-- seed-order alternation. Null = let the generator auto-balance it.
-- For doubles, both partners carry the same pool_number (the generator dedupes
-- to one team via the canonical registration).
alter table tournament_registrations
  add column if not exists pool_number int;
