-- Per-format Joinzer Score history for the profile Rating card's per-format trendlines.
-- The rating engine already computes a history snapshot per format track; the nightly
-- recompute now persists each track's Score-over-time here (mirrors profiles.primary_score_history,
-- but per format). Nullable-safe: defaults to an empty array so existing reads are unaffected.
alter table player_ratings
  add column if not exists score_history jsonb not null default '[]'::jsonb;
