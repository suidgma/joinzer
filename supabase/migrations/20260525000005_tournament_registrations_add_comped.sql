-- Add 'comped' to tournament_registrations.payment_status CHECK constraint.
-- 'comped' = organizer manual override. Counts as active for capacity and
-- scheduling gates (same as 'paid'/'waived'), but is NOT revenue and is NOT
-- refund-eligible. Replaces the 'paid' manual toggle so organizer overrides
-- can no longer masquerade as real Stripe payments.

BEGIN;

ALTER TABLE tournament_registrations
  DROP CONSTRAINT IF EXISTS tournament_registrations_payment_status_check;

ALTER TABLE tournament_registrations
  ADD CONSTRAINT tournament_registrations_payment_status_check
  CHECK (payment_status IN ('unpaid', 'paid', 'waived', 'refunded', 'comped'));

COMMIT;
