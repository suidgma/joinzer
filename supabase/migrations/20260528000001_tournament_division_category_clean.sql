-- Clean up tournament_divisions.category so it stores a true gender slice
-- only (men/women/mixed/coed/open), with team_type holding the format slice
-- (singles/doubles) separately.
--
-- Before this migration, `category` mixed both concepts and used confusing
-- value names like 'mens_doubles' even when team_type was 'singles'. The
-- format derivation in lib/taxonomy/write-helpers.ts (mapDivisionFormat)
-- already produces a separate combined `format` value, so category never
-- needed to embed team_type.
--
-- Migration order:
--   1. Drop the old CHECK constraint (it forbids any of the new values).
--   2. Backfill existing rows to the new vocabulary.
--   3. Add the new CHECK constraint with the cleaned-up allowed values.

ALTER TABLE tournament_divisions
  DROP CONSTRAINT IF EXISTS tournament_divisions_category_check;

UPDATE tournament_divisions
SET category = CASE category
  WHEN 'mens_doubles'   THEN 'men'
  WHEN 'womens_doubles' THEN 'women'
  WHEN 'mixed_doubles'  THEN 'mixed'
  -- 'singles' was always wrong-shape; the one row using it is the demo's
  -- "Open Singles" division. Remap to 'open' + team_type stays whatever it is.
  WHEN 'singles'        THEN 'open'
  WHEN 'open'           THEN 'open'
  ELSE category
END
WHERE category IN ('mens_doubles', 'womens_doubles', 'mixed_doubles', 'singles', 'open');

ALTER TABLE tournament_divisions
  ADD CONSTRAINT tournament_divisions_category_check
  CHECK (category = ANY (ARRAY['men'::text, 'women'::text, 'mixed'::text, 'coed'::text, 'open'::text]));
