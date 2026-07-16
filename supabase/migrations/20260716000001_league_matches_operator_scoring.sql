-- Let the self-run session host (and co-admins) score league_matches, not just the league owner.
-- Mirrors lib/leagues/canOperateSession.ts for the ONE client-side RLS write path: RR scoring
-- (LockedRoundsScoring / MatchEntryForm) writes league_matches directly from the client.
-- SECURITY DEFINER so the inner membership lookups bypass RLS (per docs/security.md); auth.uid()
-- still resolves to the caller.
create or replace function public.can_operate_league_session(p_session_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from league_sessions ls
    join leagues l on l.id = ls.league_id
    where ls.id = p_session_id
      and (
        l.created_by = auth.uid()
        or (l.self_run and coalesce(ls.host_user_id, l.season_host_user_id) = auth.uid())
        or exists (
          select 1 from league_registrations r
          where r.league_id = l.id and r.user_id = auth.uid() and r.is_co_admin = true
        )
      )
  );
$$;

grant execute on function public.can_operate_league_session(uuid) to authenticated;

drop policy if exists lmatch_insert on public.league_matches;
create policy lmatch_insert on public.league_matches
  for insert to authenticated
  with check (public.can_operate_league_session(session_id));

drop policy if exists lmatch_update on public.league_matches;
create policy lmatch_update on public.league_matches
  for update to authenticated
  using (public.can_operate_league_session(session_id));

drop policy if exists lmatch_delete on public.league_matches;
create policy lmatch_delete on public.league_matches
  for delete to authenticated
  using (public.can_operate_league_session(session_id));
