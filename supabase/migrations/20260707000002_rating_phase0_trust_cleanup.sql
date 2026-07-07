-- Phase 0 (rating trust cleanup): honest self-report + DUPR-verification fields.
-- Additive only. Legacy columns (dupr_rating, estimated_rating, rating_source) are
-- retained for compatibility and retired in a later phase. See docs/phases/rating-system.md.

alter table public.profiles
  add column if not exists dupr_verified boolean not null default false,
  add column if not exists dupr_last_synced_at timestamptz,
  add column if not exists self_reported_rating numeric(4,2),
  add column if not exists self_reported_scale text
    check (self_reported_scale in ('dupr','self','other'));

-- Backfill the consolidated self-report from existing data. Note: rating_source
-- 'dupr_known' was a self-claim, never a verified DUPR — so dupr_verified stays false
-- for everyone (real verification arrives with the future DUPR integration).
update public.profiles
set
  self_reported_rating = case
    when rating_source = 'dupr_known' then dupr_rating
    else coalesce(estimated_rating, dupr_rating)
  end,
  self_reported_scale = case
    when rating_source = 'dupr_known' then 'dupr'
    else 'self'
  end
where self_reported_rating is null
  and (dupr_rating is not null or estimated_rating is not null);
