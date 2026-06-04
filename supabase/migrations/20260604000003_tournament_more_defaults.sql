-- Extend tournament-level division defaults with games_to and bracket_type.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS default_games_to int NOT NULL DEFAULT 11
    CHECK (default_games_to IN (11, 15, 21)),
  ADD COLUMN IF NOT EXISTS default_bracket_type text NOT NULL DEFAULT 'round_robin'
    CHECK (default_bracket_type IN ('round_robin','single_elimination','double_elimination','pool_play_playoffs'));

-- Also update win_by default to 1.
ALTER TABLE tournaments ALTER COLUMN default_win_by SET DEFAULT 1;
