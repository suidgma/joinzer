-- Phase 1: Additive taxonomy columns + backfill
-- No columns dropped. No reads changed. Dual-write added in follow-up PR.
-- Idempotent: re-running produces no errors (IF NOT EXISTS, WHERE col IS NULL).
--
-- STATUS: Reviewed and approved 2026-05-14.
-- Unblocked 2026-05-15: Supabase Pro active, daily backups confirmed (latest 15 May 2026 09:23 UTC).
-- Pre-migration table export: C:\Users\marty\joinzer-backups\pre-1.1-20260515-2100.sql

BEGIN;

-- ============================================================
-- 1. tournament_divisions: new canonical columns
-- ============================================================

ALTER TABLE tournament_divisions
  ADD COLUMN IF NOT EXISTS format     text,
  ADD COLUMN IF NOT EXISTS skill_min  numeric(3,1),
  ADD COLUMN IF NOT EXISTS skill_max  numeric(3,1);

-- ============================================================
-- 2. leagues: expand format CHECK + add skill range columns
--    Atomic transaction — if either ALTER fails, both roll back.
--    SELECT DISTINCT format FROM leagues at migration time: ['mixed_doubles']
--    'singles' excluded intentionally: zero live rows use it. Any write
--    using 'singles' after this migration indicates an un-updated code path
--    and should fail loudly, not silently succeed.
-- ============================================================

ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_format_check;

ALTER TABLE leagues ADD CONSTRAINT leagues_format_check CHECK (format IN (
  'mens_singles', 'womens_singles', 'open_singles',
  'mens_doubles', 'womens_doubles', 'mixed_doubles',
  'coed_doubles', 'open_doubles',
  'individual_round_robin', 'custom'
));

ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS skill_min  numeric(3,1),
  ADD COLUMN IF NOT EXISTS skill_max  numeric(3,1);

-- ============================================================
-- 3. events: add skill range columns
--    Source: min_skill_level / max_skill_level (already numeric — direct copy)
-- ============================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS skill_min  numeric(3,1),
  ADD COLUMN IF NOT EXISTS skill_max  numeric(3,1);

-- ============================================================
-- 4. Backfill tournament_divisions.format
--    Precedence: clean category+team_type match wins.
--    Mismatch: category provides gender signal; team_type drives team_size.
--    Verified 2026-05-14 against live data:
--      - zzz / free event (dummy=false, 5 regs): category=mens_doubles,
--        team_type=singles → mens_singles. UI already renders as singles;
--        team_type is the source of truth here.
--      - All other coerced rows are dummy=true (verified via query).
-- ============================================================

UPDATE tournament_divisions SET format = CASE
  -- Clean matches
  WHEN category = 'mens_doubles'   AND team_type = 'doubles' THEN 'mens_doubles'
  WHEN category = 'womens_doubles' AND team_type = 'doubles' THEN 'womens_doubles'
  WHEN category = 'mixed_doubles'  AND team_type = 'doubles' THEN 'mixed_doubles'
  WHEN category = 'singles'        AND team_type = 'singles' THEN 'open_singles'
  WHEN category = 'open'           AND team_type = 'singles' THEN 'open_singles'
  -- Mismatched pairs: category provides gender signal, team_type=singles wins
  WHEN category = 'mens_doubles'   AND team_type = 'singles' THEN 'mens_singles'
  WHEN category = 'womens_doubles' AND team_type = 'singles' THEN 'womens_singles'
  WHEN category = 'mixed_doubles'  AND team_type = 'singles' THEN 'open_singles'
  -- Generic fallback (not reached given live data inventory as of 2026-05-14)
  WHEN team_type = 'doubles' THEN 'mixed_doubles'
  WHEN team_type = 'singles' THEN 'open_singles'
  ELSE 'mixed_doubles'
END
WHERE format IS NULL;

-- ============================================================
-- 5. Backfill tournament_divisions skill range
--    skill_level stored as Title Case ('Beginner', 'Intermediate', 'Advanced')
-- ============================================================

UPDATE tournament_divisions SET
  skill_min = CASE skill_level
    WHEN 'Beginner'     THEN 2.0
    WHEN 'Intermediate' THEN 3.0
    WHEN 'Advanced'     THEN 4.0
    ELSE NULL
  END,
  skill_max = CASE skill_level
    WHEN 'Beginner'     THEN 2.5
    WHEN 'Intermediate' THEN 3.5
    WHEN 'Advanced'     THEN 4.5
    ELSE NULL
  END
WHERE skill_min IS NULL AND skill_max IS NULL;

-- ============================================================
-- 6. Backfill leagues skill range
--    skill_level stored lowercase ('beginner', 'intermediate', etc.)
-- ============================================================

UPDATE leagues SET
  skill_min = CASE skill_level
    WHEN 'beginner'          THEN 2.0
    WHEN 'beginner_plus'     THEN 2.5
    WHEN 'intermediate'      THEN 3.0
    WHEN 'intermediate_plus' THEN 3.5
    WHEN 'advanced'          THEN 4.0
    WHEN 'advanced_plus'     THEN 4.5
    ELSE NULL
  END,
  skill_max = CASE skill_level
    WHEN 'beginner'          THEN 2.5
    WHEN 'beginner_plus'     THEN 3.0
    WHEN 'intermediate'      THEN 3.5
    WHEN 'intermediate_plus' THEN 4.0
    WHEN 'advanced'          THEN 4.5
    WHEN 'advanced_plus'     THEN 5.0
    ELSE NULL
  END
WHERE skill_min IS NULL AND skill_max IS NULL;

-- ============================================================
-- 7. Backfill events skill range (direct numeric copy)
-- ============================================================

UPDATE events SET
  skill_min = min_skill_level,
  skill_max = max_skill_level
WHERE skill_min IS NULL AND skill_max IS NULL
  AND (min_skill_level IS NOT NULL OR max_skill_level IS NOT NULL);

COMMIT;

-- ============================================================
-- Post-migration verification (run manually after applying)
-- ============================================================

-- 1. Expect 0: no divisions left without a format
-- SELECT COUNT(*) FROM tournament_divisions WHERE format IS NULL;

-- 2. Expect 1 row: zzz / free event (mens_singles) — the one real production
--    coerced division. Review with organizer before Phase 3 drops old columns.
-- SELECT d.id, d.name, d.category, d.team_type, d.format,
--        t.name AS tournament_name
-- FROM tournament_divisions d
-- JOIN tournaments t ON t.id = d.tournament_id
-- WHERE (
--   (d.category = 'singles'        AND d.team_type = 'doubles') OR
--   (d.category = 'mens_doubles'   AND d.team_type = 'singles') OR
--   (d.category = 'womens_doubles' AND d.team_type = 'singles') OR
--   (d.category = 'mixed_doubles'  AND d.team_type = 'singles') OR
--   (d.category = 'open'           AND d.team_type = 'singles')
-- )
-- AND NOT EXISTS (
--   SELECT 1 FROM tournaments t2 WHERE t2.id = d.tournament_id AND t2.dummy = true
-- );
