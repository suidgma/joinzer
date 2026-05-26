ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS estimated_end_time time;
