ALTER TABLE league_sessions
  ADD COLUMN IF NOT EXISTS session_time time;
