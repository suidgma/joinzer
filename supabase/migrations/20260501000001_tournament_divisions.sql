-- Drop old incompatible tournament_registrations table
DROP TABLE IF EXISTS tournament_registrations CASCADE;

-- ── tournament_divisions ─────────────────────────────────────────────
CREATE TABLE tournament_divisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id    uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name             text NOT NULL,
  category         text NOT NULL CHECK (category IN ('mens_doubles','womens_doubles','mixed_doubles','singles','open')),
  skill_level      text,
  team_type        text NOT NULL CHECK (team_type IN ('singles','doubles')),
  max_entries      integer NOT NULL DEFAULT 16,
  waitlist_enabled boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','closed')),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

ALTER TABLE tournament_divisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "divisions_read" ON tournament_divisions
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "divisions_organizer_insert" ON tournament_divisions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM tournaments WHERE id = tournament_id AND organizer_id = auth.uid()
  ));

CREATE POLICY "divisions_organizer_update" ON tournament_divisions
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tournaments WHERE id = tournament_id AND organizer_id = auth.uid()
  ));

CREATE POLICY "divisions_organizer_delete" ON tournament_divisions
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tournaments WHERE id = tournament_id AND organizer_id = auth.uid()
  ));

CREATE TRIGGER divisions_updated_at
  BEFORE UPDATE ON tournament_divisions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── tournament_registrations ─────────────────────────────────────────
CREATE TABLE tournament_registrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  division_id     uuid NOT NULL REFERENCES tournament_divisions(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  team_name       text,
  status          text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','waitlisted','cancelled')),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

ALTER TABLE tournament_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "registrations_read" ON tournament_registrations
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "registrations_user_insert" ON tournament_registrations
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "registrations_update" ON tournament_registrations
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM tournaments t
      JOIN tournament_divisions d ON d.tournament_id = t.id
      WHERE d.id = division_id AND t.organizer_id = auth.uid()
    )
  );

CREATE TRIGGER registrations_updated_at
  BEFORE UPDATE ON tournament_registrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
