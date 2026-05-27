-- Refund route writes payment_status='refunded' and refunded_at, but the
-- original CHECK constraint and column set didn't allow it. Add both so
-- refund + waitlist-promotion paths work end-to-end.

ALTER TABLE tournament_registrations
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

ALTER TABLE tournament_registrations
  DROP CONSTRAINT IF EXISTS tournament_registrations_payment_status_check;

ALTER TABLE tournament_registrations
  ADD CONSTRAINT tournament_registrations_payment_status_check
    CHECK (payment_status IN ('unpaid', 'paid', 'waived', 'refunded'));
