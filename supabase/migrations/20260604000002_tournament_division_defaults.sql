-- Tournament-level defaults that pre-populate when adding divisions.
-- Organizers set these once; divisions inherit and can override.

-- Default win-by for all divisions in this tournament (1 or 2).
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS default_win_by int NOT NULL DEFAULT 2
    CHECK (default_win_by IN (1, 2));

-- Per-division venue override — inherits tournament location_id by default.
ALTER TABLE tournament_divisions
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id);
