-- Schedule Builder default match length for NEW tournaments: 20 → 15 min.
-- Keeps the column default aligned with lib/types.ts DEFAULT_SCHEDULE_SETTINGS
-- (also changed to 15). Only match_duration_minutes changes; every other key is
-- unchanged from 20260625000001_schedule_settings_default_20_0_0.
--
-- Affects future inserts only. Existing tournaments keep their stored settings.
alter table tournaments
  alter column schedule_settings_json set default '{
    "match_duration_minutes": 15,
    "buffer_minutes": 0,
    "min_rest_minutes": 0,
    "conflict_policy": "warning",
    "keep_divisions_grouped": true,
    "allow_division_overlap": true,
    "allow_court_sharing": true,
    "schedule_by_priority": false,
    "leave_end_buffer": false,
    "end_buffer_minutes": 0
  }'::jsonb;
