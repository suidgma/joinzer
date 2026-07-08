-- Organizer onboarding Phase 1: capture what a new user came to Joinzer to do.
-- Nullable + additive (existing users = null = unknown). Drives post-signup routing
-- (organize → guided create-first-event) and a tailored home for declared organizers.
alter table profiles
  add column if not exists signup_intent text
  check (signup_intent in ('play', 'organize', 'both'));
