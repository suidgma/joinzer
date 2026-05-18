-- Ticket 4.1.5: rename format_type → bracket_type on tournament_divisions
--
-- NOT IDEMPOTENT: will fail with "column format_type does not exist" if re-run.
-- Apply once only. Rollback SQL: docs/investigations/format-type-rename-2026-05-18.md §5
-- Applied 2026-05-18, merge 2e56ab8

BEGIN;

-- Rename the column
ALTER TABLE tournament_divisions
  RENAME COLUMN format_type TO bracket_type;

-- Rename the CHECK constraint (body auto-updates; name does not)
ALTER TABLE tournament_divisions
  RENAME CONSTRAINT tournament_divisions_format_type_check
  TO tournament_divisions_bracket_type_check;

COMMIT;
