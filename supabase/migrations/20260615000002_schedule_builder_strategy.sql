-- Advanced Schedule Builder — strategy controls (additive, zero behavior change).
-- Persist each draft/published match's estimated end time, and let organizers set
-- a per-division priority within a block (used by the "schedule by division
-- priority" setting). assignment_type is structural for future multi-block
-- divisions (e.g. 'pool' vs 'playoff') and is unused for now.

alter table tournament_matches
  add column if not exists scheduled_end_time timestamptz;

alter table tournament_division_blocks
  add column if not exists priority int not null default 0;

alter table tournament_division_blocks
  add column if not exists assignment_type text;
