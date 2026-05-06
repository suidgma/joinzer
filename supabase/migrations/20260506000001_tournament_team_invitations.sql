-- Add payment_status tracking to registrations
ALTER TABLE tournament_registrations
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'paid', 'waived'));

-- Partner invitation tokens
CREATE TABLE IF NOT EXISTS tournament_team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  division_id uuid NOT NULL REFERENCES tournament_divisions(id) ON DELETE CASCADE,
  inviter_registration_id uuid NOT NULL REFERENCES tournament_registrations(id) ON DELETE CASCADE,
  invitee_email text NOT NULL,
  invitee_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE tournament_team_invitations ENABLE ROW LEVEL SECURITY;

-- All reads/writes go through the service role (API routes only)
CREATE POLICY "service role manages invitations"
  ON tournament_team_invitations
  FOR ALL
  USING (true)
  WITH CHECK (true);
