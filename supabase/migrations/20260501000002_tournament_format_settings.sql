ALTER TABLE tournament_divisions
  ADD COLUMN format_type text NOT NULL DEFAULT 'round_robin'
    CHECK (format_type IN ('round_robin','single_elimination','double_elimination','pool_play_playoffs')),
  ADD COLUMN format_settings_json jsonb DEFAULT '{"games_to":11,"win_by":2,"cap_score":null,"ranking_method":"wins"}'::jsonb;
