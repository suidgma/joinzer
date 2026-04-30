-- Add FK to profiles so PostgREST can resolve the join in select queries
ALTER TABLE league_messages
  ADD CONSTRAINT league_messages_user_id_profiles_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE tournament_messages
  ADD CONSTRAINT tournament_messages_user_id_profiles_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
