-- Play event chat was not in the realtime publication, so new messages from
-- other participants only appeared on a reload. Add event_messages to match
-- league_messages / tournament_messages (INSERT-only subscription; no REPLICA
-- IDENTITY change needed since chat never subscribes to UPDATE/DELETE).
alter publication supabase_realtime add table public.event_messages;
