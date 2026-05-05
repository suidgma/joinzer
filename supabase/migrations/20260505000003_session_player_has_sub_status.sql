ALTER TABLE league_session_players DROP CONSTRAINT IF EXISTS league_session_players_actual_status_check;
ALTER TABLE league_session_players
  ADD CONSTRAINT league_session_players_actual_status_check
  CHECK (actual_status IN ('present', 'coming', 'late', 'cannot_attend', 'not_present', 'has_sub'));
