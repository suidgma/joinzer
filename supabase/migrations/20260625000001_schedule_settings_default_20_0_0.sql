-- Schedule Builder defaults for NEW tournaments: 20-min matches, no buffer,
-- no min rest. The original advanced_schedule_builder migration baked a
-- 25/5/10 column default that overrode lib/types.ts DEFAULT_SCHEDULE_SETTINGS
-- (already 20/0/0) for every fresh tournament row, since the create form
-- doesn't set schedule_settings_json explicitly. This realigns the column
-- default with the TS source of truth and fills in the two strategy keys
-- (allow_court_sharing, schedule_by_priority) the old default was missing.
--
-- Affects future inserts only. Existing tournaments keep their stored settings.
alter table tournaments
  alter column schedule_settings_json set default '{
    "match_duration_minutes": 20,
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
