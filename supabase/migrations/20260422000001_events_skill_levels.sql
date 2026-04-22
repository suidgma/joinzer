alter table events
  add column if not exists min_skill_level decimal(3,1) check (min_skill_level >= 2.0 and min_skill_level <= 8.0),
  add column if not exists max_skill_level decimal(3,1) check (max_skill_level >= 2.0 and max_skill_level <= 8.0);
