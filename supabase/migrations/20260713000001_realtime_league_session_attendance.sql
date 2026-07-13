-- Stream attendance changes so players can watch a live "who's coming" list fill
-- in before a session. REPLICA IDENTITY FULL makes UPDATE payloads + filters
-- reliable (a player's attendance row is updated in place when they change status).
alter table public.league_session_attendance replica identity full;
alter publication supabase_realtime add table public.league_session_attendance;
