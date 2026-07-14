-- Let authors edit/delete their own league & tournament chat messages (event_messages
-- already has these). Author-scoped; membership isn't re-checked (only affects your own row).
create policy "league_messages_update" on public.league_messages
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "league_messages_delete" on public.league_messages
  for delete to authenticated using (user_id = auth.uid());
create policy "tournament_messages_update" on public.tournament_messages
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "tournament_messages_delete" on public.tournament_messages
  for delete to authenticated using (user_id = auth.uid());
