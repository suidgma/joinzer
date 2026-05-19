-- B6: Fix payment_status CHECK constraint to allow 'refunded'
-- Also backfill the 1 known broken row (Marty's test cancellation, refund issued by Stripe but DB never caught up due to constraint mismatch).
-- Applied 2026-05-19. Verified: 0 rows in broken state, Marty's row 2493b247 backfilled correctly, constraint confirmed via pg_get_constraintdef.
--
-- Idempotent: re-running adds no errors (DROP IF EXISTS + WHERE filter on backfill).
-- Apply once. Rollback: drop the new constraint, re-add the old one with the original 3-value list. Backfill is non-destructive — payment_status='refunded' is the correct value semantically.

BEGIN;

-- 1. Replace CHECK constraint
ALTER TABLE tournament_registrations
  DROP CONSTRAINT IF EXISTS tournament_registrations_payment_status_check;

ALTER TABLE tournament_registrations
  ADD CONSTRAINT tournament_registrations_payment_status_check
  CHECK (payment_status IN ('unpaid', 'paid', 'waived', 'refunded'));

-- 2. Backfill cancelled-but-paid rows with stripe_payment_intent_id set
-- These rows had their refund issued by Stripe but the DB update silently failed against the old CHECK constraint.
-- Set refunded_at to the row's updated_at (within ~1 second of the actual Stripe refund completion time).
UPDATE tournament_registrations
SET payment_status = 'refunded',
    refunded_at = updated_at
WHERE status = 'cancelled'
  AND payment_status = 'paid'
  AND stripe_payment_intent_id IS NOT NULL
  AND refunded_at IS NULL;

COMMIT;

-- Post-migration verification (run manually):
-- 1. Expect 0 rows: SELECT COUNT(*) FROM tournament_registrations WHERE status='cancelled' AND payment_status='paid' AND stripe_payment_intent_id IS NOT NULL;
-- 2. Expect 1 row updated: SELECT id, payment_status, refunded_at FROM tournament_registrations WHERE id='2493b247-ca3c-42df-858d-8fca67c8f1e8';
-- 3. Verify new constraint: SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='tournament_registrations_payment_status_check';
