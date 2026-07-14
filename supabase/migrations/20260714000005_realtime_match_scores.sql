-- Live scores: publish the match/session tables so postgres_changes fires. All three are
-- already client-readable (tournament_matches: anon+auth via matches_read; league_matches
-- and league_session_players: authenticated), so no RLS change is needed. This revives the
-- LiveScoreboard (tournament_matches) and LiveSessionManager (league_session_players)
-- subscriptions, which were dead because the tables were never in the publication.
-- league_fixtures stays deny-all (box/ladder/team/flex) and would use server broadcast.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tournament_matches') then
    alter publication supabase_realtime add table public.tournament_matches;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'league_matches') then
    alter publication supabase_realtime add table public.league_matches;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'league_session_players') then
    alter publication supabase_realtime add table public.league_session_players;
  end if;
end $$;
