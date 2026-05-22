-- Add CHECK constraints to league_sub_requests for division_type and requested_skill_level.
-- Table has 0 rows in prod so no existing data can violate.
-- Both columns are nullable; IN() passes NULL through, so nullable behavior is unchanged.
--
-- division_type mirrors leagues_format_check exactly (10 values).
-- requested_skill_level mirrors leagues.skill_level (5 values — advanced_plus is NOT
--   in leagues_skill_level_check; add there first before propagating here).
--
-- status already has league_sub_requests_status_check from the original CREATE TABLE
-- in 20260502000001 with ('open','claimed','approved','cancelled','fulfilled').
-- 'fulfilled' is a planned-but-unimplemented state — not touched here.

ALTER TABLE public.league_sub_requests
  ADD CONSTRAINT league_sub_requests_division_type_check
  CHECK (division_type IN (
    'mens_singles', 'womens_singles', 'open_singles',
    'mens_doubles', 'womens_doubles', 'mixed_doubles',
    'coed_doubles', 'open_doubles', 'individual_round_robin', 'custom'
  ));

ALTER TABLE public.league_sub_requests
  ADD CONSTRAINT league_sub_requests_requested_skill_level_check
  CHECK (requested_skill_level IN (
    'beginner', 'beginner_plus', 'intermediate', 'intermediate_plus', 'advanced'
  ));
