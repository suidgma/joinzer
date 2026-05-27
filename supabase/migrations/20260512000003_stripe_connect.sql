-- Stripe Connect: organizers connect their own Stripe Express account so
-- registration payments route to them. Joinzer keeps a small application fee.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_account_id text;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_stripe_account_id_unique
  ON profiles(stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;
