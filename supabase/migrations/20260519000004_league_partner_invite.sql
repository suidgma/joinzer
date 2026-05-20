BEGIN;

ALTER TABLE public.league_registrations
  DROP CONSTRAINT league_registrations_status_check,
  ADD CONSTRAINT league_registrations_status_check
    CHECK (status IN ('registered', 'waitlist', 'cancelled', 'pending_partner'));

ALTER TABLE public.league_registrations
  DROP CONSTRAINT league_registrations_payment_status_check,
  ADD CONSTRAINT league_registrations_payment_status_check
    CHECK (payment_status IN ('free', 'unpaid', 'paid', 'waived', 'authorized'));

CREATE INDEX IF NOT EXISTS league_registrations_pending_partner_idx
  ON public.league_registrations (registered_at)
  WHERE status = 'pending_partner';

CREATE TABLE IF NOT EXISTS public.league_partner_invitations (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id                 uuid        NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  captain_registration_id   uuid        NOT NULL REFERENCES league_registrations(id) ON DELETE CASCADE,
  invitee_email             text        NOT NULL,
  invitee_user_id           uuid        NULL REFERENCES profiles(id) ON DELETE SET NULL,
  token                     text        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  status                    text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  expires_at                timestamptz NOT NULL,
  invitation_email_sent_at  timestamptz NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.league_partner_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages league partner invitations"
  ON public.league_partner_invitations FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS league_partner_invitations_captain_reg_idx
  ON public.league_partner_invitations (captain_registration_id);
CREATE INDEX IF NOT EXISTS league_partner_invitations_pending_expires_idx
  ON public.league_partner_invitations (expires_at)
  WHERE status = 'pending';

COMMIT;
