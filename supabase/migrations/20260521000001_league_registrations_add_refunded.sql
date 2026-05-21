-- 3.4.1-L: Widen league_registrations.payment_status CHECK to include 'refunded'
-- Also adds refunded_at column for audit parity with tournament_registrations.
-- Required before league-cancel route can write payment_status='refunded'.
-- Idempotent: ADD COLUMN IF NOT EXISTS; DROP CONSTRAINT by name then re-add.

BEGIN;

-- 1. Replace CHECK constraint (league_registrations currently allows:
--    'free', 'unpaid', 'paid', 'waived', 'authorized' — missing 'refunded')
ALTER TABLE league_registrations
  DROP CONSTRAINT IF EXISTS league_registrations_payment_status_check;

ALTER TABLE league_registrations
  ADD CONSTRAINT league_registrations_payment_status_check
  CHECK (payment_status = ANY (ARRAY[
    'free'::text, 'unpaid'::text, 'paid'::text,
    'waived'::text, 'authorized'::text, 'refunded'::text
  ]));

-- 2. Add refunded_at for audit trail (matches tournament_registrations pattern)
ALTER TABLE league_registrations
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz NULL;

COMMIT;

-- Post-migration verification (paste results back before writing route):
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='league_registrations' AND column_name='refunded_at';
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname='league_registrations_payment_status_check';
