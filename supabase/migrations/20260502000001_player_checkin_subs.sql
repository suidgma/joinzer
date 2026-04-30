-- ── league_session_attendance ────────────────────────────────────────────────
-- Player self check-in; separate from organizer-controlled league_session_players

CREATE TABLE league_session_attendance (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_session_id   uuid NOT NULL REFERENCES league_sessions(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attendance_status   text NOT NULL DEFAULT 'not_responded'
    CHECK (attendance_status IN (
      'planning_to_attend','cannot_attend','checked_in_present','running_late','not_responded'
    )),
  checked_in_at       timestamptz,
  updated_at          timestamptz DEFAULT now(),
  updated_by_user_id  uuid REFERENCES auth.users(id),
  notes               text,
  UNIQUE(league_session_id, user_id)
);

ALTER TABLE league_session_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lsa_read" ON league_session_attendance
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "lsa_insert_own" ON league_session_attendance
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Own updates; organizer overrides go through service role in API routes
CREATE POLICY "lsa_update_own" ON league_session_attendance
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());


-- ── league_sub_requests ────────────────────────────────────────────────────────
-- Formal sub request system; replaces ad-hoc league_session_subs for this flow

CREATE TABLE league_sub_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id             uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  league_session_id     uuid NOT NULL REFERENCES league_sessions(id) ON DELETE CASCADE,
  requesting_player_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_skill_level text,
  division_type         text,
  status                text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','claimed','approved','cancelled','fulfilled')),
  claimed_by_user_id    uuid REFERENCES auth.users(id),
  approved_by_user_id   uuid REFERENCES auth.users(id),
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  notes                 text
);

ALTER TABLE league_sub_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lsr_read" ON league_sub_requests
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "lsr_insert_own" ON league_sub_requests
  FOR INSERT TO authenticated
  WITH CHECK (requesting_player_id = auth.uid());

-- Updates (claim, approve, cancel) go through service role in API routes
-- No client-side UPDATE policy — all mutations are server-side enforced
