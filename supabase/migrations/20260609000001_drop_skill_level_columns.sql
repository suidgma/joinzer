-- Phase 4.2: drop legacy skill_level columns from leagues and tournament_divisions.
--
-- These columns were populated during the Phase 1 taxonomy migration (20260514000001)
-- and dual-written in Phase 2 (write-helpers.ts). Phase 3B switched all reads to
-- skill_min / skill_max. Dual-write was removed from write-helpers.ts before this
-- migration was applied.
--
-- SAFETY CHECKS:
--   - No application code reads skill_level from these tables after write-helpers cleanup.
--   - league_sub_requests.requested_skill_level is a SEPARATE column — NOT touched here.
--   - events.session_type is a SEPARATE, still-active column — NOT touched here.
--
-- Rehearse on staging before running on prod. Confirm a prod backup exists first.

ALTER TABLE leagues
  DROP COLUMN IF EXISTS skill_level;

ALTER TABLE tournament_divisions
  DROP COLUMN IF EXISTS skill_level;
