-- Migrate left_early → not_present, replace constraint with new 5-value set
UPDATE league_session_players SET actual_status = 'not_present' WHERE actual_status = 'left_early';

ALTER TABLE league_session_players DROP CONSTRAINT IF EXISTS league_session_players_actual_status_check;

ALTER TABLE league_session_players
  ADD CONSTRAINT league_session_players_actual_status_check
  CHECK (actual_status IN ('present', 'coming', 'late', 'cannot_attend', 'not_present'));
