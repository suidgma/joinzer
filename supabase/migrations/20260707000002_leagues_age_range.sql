-- Age range for leagues (informational eligibility, mirrors skill_min/skill_max).
-- Additive + nullable; existing leagues are unaffected (no age restriction).
alter table leagues add column if not exists age_min int;
alter table leagues add column if not exists age_max int;
