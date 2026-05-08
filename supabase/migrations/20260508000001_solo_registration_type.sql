-- Solo/individual registration support for doubles tournaments and leagues

ALTER TABLE tournament_registrations
  ADD COLUMN IF NOT EXISTS registration_type text NOT NULL DEFAULT 'team'
    CHECK (registration_type IN ('team', 'solo')),
  ADD COLUMN IF NOT EXISTS partner_registration_id uuid REFERENCES tournament_registrations(id) ON DELETE SET NULL;

ALTER TABLE league_registrations
  ADD COLUMN IF NOT EXISTS registration_type text NOT NULL DEFAULT 'team'
    CHECK (registration_type IN ('team', 'solo')),
  ADD COLUMN IF NOT EXISTS partner_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_registration_id uuid REFERENCES league_registrations(id) ON DELETE SET NULL;
