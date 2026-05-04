-- Add scoring settings to leagues
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS points_to_win integer NOT NULL DEFAULT 11,
  ADD COLUMN IF NOT EXISTS win_by        integer NOT NULL DEFAULT 1
    CHECK (win_by IN (1, 2));
