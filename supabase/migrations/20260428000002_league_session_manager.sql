-- League Session Manager schema
-- Adds three tables: session players (rich attendance), rounds, and round matches.
-- Extends league_sessions with courts + rounds_planned.

ALTER TABLE league_sessions
  ADD COLUMN IF NOT EXISTS number_of_courts integer DEFAULT 4,
  ADD COLUMN IF NOT EXISTS rounds_planned integer DEFAULT 7;

-- -----------------------------------------------
-- league_session_players
-- One row per player per session. Populated from
-- league_registrations when the session opens.
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS league_session_players (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid NOT NULL REFERENCES league_sessions(id) ON DELETE CASCADE,
  user_id            uuid REFERENCES profiles(id),
  display_name       text NOT NULL,
  player_type        text NOT NULL DEFAULT 'roster_player'
                       CHECK (player_type IN ('roster_player', 'sub', 'guest')),
  expected_status    text NOT NULL DEFAULT 'expected'
                       CHECK (expected_status IN ('expected', 'out', 'maybe', 'unknown')),
  actual_status      text NOT NULL DEFAULT 'not_present'
                       CHECK (actual_status IN ('present', 'not_present', 'late', 'left_early')),
  arrived_after_round integer,
  joinzer_rating     integer DEFAULT 1000,
  dupr_rating        numeric,
  estimated_rating   numeric,
  notes              text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lsp_session ON league_session_players(session_id);
CREATE INDEX IF NOT EXISTS idx_lsp_user    ON league_session_players(user_id);

-- -----------------------------------------------
-- league_rounds
-- One row per round per session (draft → locked → completed).
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS league_rounds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL REFERENCES league_sessions(id) ON DELETE CASCADE,
  round_number     integer NOT NULL,
  status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'locked', 'completed')),
  generation_notes text,
  locked_at        timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (session_id, round_number)
);

CREATE INDEX IF NOT EXISTS idx_lr_session ON league_rounds(session_id);

-- -----------------------------------------------
-- league_round_matches
-- Scheduling rows (not results). team/singles/bye
-- fields reference league_session_players.id.
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS league_round_matches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id            uuid NOT NULL REFERENCES league_rounds(id) ON DELETE CASCADE,
  session_id          uuid NOT NULL REFERENCES league_sessions(id) ON DELETE CASCADE,
  court_number        integer,
  match_type          text NOT NULL CHECK (match_type IN ('doubles', 'singles', 'bye')),
  -- doubles
  team1_player1_id    uuid REFERENCES league_session_players(id),
  team1_player2_id    uuid REFERENCES league_session_players(id),
  team2_player1_id    uuid REFERENCES league_session_players(id),
  team2_player2_id    uuid REFERENCES league_session_players(id),
  -- singles
  singles_player1_id  uuid REFERENCES league_session_players(id),
  singles_player2_id  uuid REFERENCES league_session_players(id),
  -- bye
  bye_player_id       uuid REFERENCES league_session_players(id),
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lrm_round   ON league_round_matches(round_id);
CREATE INDEX IF NOT EXISTS idx_lrm_session ON league_round_matches(session_id);

-- -----------------------------------------------
-- RLS: authenticated users read; service_role writes
-- -----------------------------------------------
ALTER TABLE league_session_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_rounds          ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_round_matches   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read session players"
  ON league_session_players FOR SELECT TO authenticated USING (true);

CREATE POLICY "service write session players"
  ON league_session_players FOR ALL TO service_role USING (true);

CREATE POLICY "auth read rounds"
  ON league_rounds FOR SELECT TO authenticated USING (true);

CREATE POLICY "service write rounds"
  ON league_rounds FOR ALL TO service_role USING (true);

CREATE POLICY "auth read round matches"
  ON league_round_matches FOR SELECT TO authenticated USING (true);

CREATE POLICY "service write round matches"
  ON league_round_matches FOR ALL TO service_role USING (true);
