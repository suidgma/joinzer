-- Create tournament_team_invitations — created out-of-band, no tracked migration.
-- Placed after 20260430154117 (creates tournaments, tournament_divisions,
-- tournament_registrations) because this table has FK references to all three.
-- IF NOT EXISTS → no-op on prod. DROP POLICY IF EXISTS + CREATE → idempotent.

CREATE TABLE IF NOT EXISTS public.tournament_team_invitations (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id           uuid        NOT NULL
    REFERENCES public.tournaments(id) ON DELETE CASCADE,
  division_id             uuid        NOT NULL
    REFERENCES public.tournament_divisions(id) ON DELETE CASCADE,
  inviter_registration_id uuid        NOT NULL
    REFERENCES public.tournament_registrations(id) ON DELETE CASCADE,
  invitee_email           text        NOT NULL,
  invitee_user_id         uuid
    REFERENCES public.profiles(id) ON DELETE SET NULL,
  token                   text        NOT NULL UNIQUE
    DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  status                  text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','expired')),
  created_at              timestamptz DEFAULT now()
);

ALTER TABLE public.tournament_team_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role manages invitations" ON public.tournament_team_invitations;
CREATE POLICY "service role manages invitations"
  ON public.tournament_team_invitations FOR ALL
  USING (true) WITH CHECK (true);
