-- Group chat tables for leagues and tournaments

CREATE TABLE league_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_text text NOT NULL CHECK (char_length(message_text) > 0 AND char_length(message_text) <= 1000),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX league_messages_league_id_created_at_idx
  ON league_messages (league_id, created_at);

ALTER TABLE league_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "league_messages_select" ON league_messages
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "league_messages_insert" ON league_messages
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());


CREATE TABLE tournament_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_text text NOT NULL CHECK (char_length(message_text) > 0 AND char_length(message_text) <= 1000),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX tournament_messages_tournament_id_created_at_idx
  ON tournament_messages (tournament_id, created_at);

ALTER TABLE tournament_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tournament_messages_select" ON tournament_messages
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "tournament_messages_insert" ON tournament_messages
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
