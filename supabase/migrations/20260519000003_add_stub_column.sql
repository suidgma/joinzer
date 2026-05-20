-- Ticket 1.5: mark profiles created via CSV import as stubs until claimed
-- A stub user has an auth account + profile row but has not completed onboarding.
-- The app layout and auth callback redirect is_stub=true users to /profile/setup
-- on every visit until they complete setup (which sets is_stub=false via upsert).
ALTER TABLE public.profiles
  ADD COLUMN is_stub boolean NOT NULL DEFAULT false;
