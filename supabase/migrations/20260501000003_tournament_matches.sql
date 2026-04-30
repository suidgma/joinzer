CREATE TABLE tournament_matches (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id           uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  division_id             uuid NOT NULL REFERENCES tournament_divisions(id) ON DELETE CASCADE,
  round_number            integer,
  match_number            integer NOT NULL,
  match_stage             text NOT NULL DEFAULT 'round_robin'
    CHECK (match_stage IN ('round_robin','winners_bracket','losers_bracket','championship','pool_play','playoffs','consolation')),
  pool_number             integer,
  court_number            integer,
  scheduled_time          timestamptz,
  team_1_registration_id  uuid REFERENCES tournament_registrations(id) ON DELETE SET NULL,
  team_2_registration_id  uuid REFERENCES tournament_registrations(id) ON DELETE SET NULL,
  team_1_score            integer,
  team_2_score            integer,
  winner_registration_id  uuid REFERENCES tournament_registrations(id) ON DELETE SET NULL,
  status                  text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

ALTER TABLE tournament_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matches_read" ON tournament_matches
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "matches_organizer_insert" ON tournament_matches
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM tournaments WHERE id = tournament_id AND organizer_id = auth.uid()
  ));

CREATE POLICY "matches_organizer_update" ON tournament_matches
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tournaments WHERE id = tournament_id AND organizer_id = auth.uid()
  ));

CREATE POLICY "matches_organizer_delete" ON tournament_matches
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tournaments WHERE id = tournament_id AND organizer_id = auth.uid()
  ));

CREATE TRIGGER matches_updated_at
  BEFORE UPDATE ON tournament_matches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
