ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS no_play_dates date[] NOT NULL DEFAULT '{}';
