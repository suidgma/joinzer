-- Add payment_status to tournament_registrations, which was created out-of-band
-- before migration tracking began. Migration 20260519165230 attempts DROP+ADD
-- CONSTRAINT on this column; it fails on fresh branches because the column is absent.
-- IF NOT EXISTS → no-op on prod (column already exists).

ALTER TABLE public.tournament_registrations
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'paid', 'waived'));
