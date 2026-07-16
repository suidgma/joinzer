-- Chat message deletes weren't propagating to other viewers. The realtime subscription filters by
-- the entity id (league_id / tournament_id / event_id), but under the default replica identity a
-- DELETE's old-record carries only the primary key — so the realtime filter can't match and the
-- DELETE event is dropped for everyone but the deleter (INSERT/UPDATE ship the full new row, so
-- they propagated fine). REPLICA IDENTITY FULL logs the whole old row, so the filter matches on
-- DELETE and other viewers receive it (useRealtimeList removes the row by old.id).
alter table public.league_messages replica identity full;
alter table public.tournament_messages replica identity full;
alter table public.event_messages replica identity full;
