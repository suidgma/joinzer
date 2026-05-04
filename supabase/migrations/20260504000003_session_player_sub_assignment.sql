-- Link a sub session player to the absent roster player they are covering for.
-- Used to apply sub_credit_cap during scoring.
ALTER TABLE league_session_players
  ADD COLUMN IF NOT EXISTS sub_for_session_player_id uuid
    REFERENCES league_session_players(id) ON DELETE SET NULL;
