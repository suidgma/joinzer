-- Co-organizers and volunteers can manage tournaments alongside the primary organizer.
-- The primary organizer remains in tournaments.organizer_id (single source of truth for ownership);
-- additional helpers go in this table.

CREATE TABLE tournament_staff (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'co_organizer'
                  CHECK (role IN ('co_organizer', 'volunteer')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, user_id)
);

CREATE INDEX tournament_staff_tournament_idx ON tournament_staff(tournament_id);
CREATE INDEX tournament_staff_user_idx       ON tournament_staff(user_id);

ALTER TABLE tournament_staff ENABLE ROW LEVEL SECURITY;

-- Reads: organizer + listed staff can see the staff list for their tournament.
CREATE POLICY "staff_read" ON tournament_staff
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM tournaments WHERE id = tournament_id AND organizer_id = auth.uid())
    OR user_id = auth.uid()
  );

-- Writes go through the service role only (the staff-management API routes).
-- We deliberately do NOT grant insert/update/delete to authenticated, so even the
-- primary organizer must hit the API (which enforces ownership + invariants like
-- "you cannot demote yourself" and resolves invites by email).
