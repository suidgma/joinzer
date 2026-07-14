-- Chat RLS hardening: scope message SELECT (and league/tournament INSERT) to membership.
-- Previously SELECT was USING(true) — any authenticated user could read ANY league/
-- tournament/event chat. league/tournament INSERT only checked user_id = auth.uid() (any
-- authed user could post to any chat). event_messages INSERT was already scoped.
--
-- Membership is checked via SECURITY DEFINER helpers so the policy can read the membership
-- tables even though they're deny-all under RLS; auth.uid() still resolves to the caller.
-- Locked search_path per the security guidelines. Server writes use the service role and
-- bypass RLS, so they're unaffected.

create or replace function public.is_league_chat_member(p_league_id uuid)
returns boolean language sql security definer set search_path = public, pg_temp stable as $$
  select exists (select 1 from league_registrations lr
                 where lr.league_id = p_league_id and lr.user_id = auth.uid() and lr.status <> 'cancelled')
      or exists (select 1 from leagues l where l.id = p_league_id and l.created_by = auth.uid());
$$;

create or replace function public.is_tournament_chat_member(p_tournament_id uuid)
returns boolean language sql security definer set search_path = public, pg_temp stable as $$
  select exists (select 1 from tournament_registrations tr
                 where tr.tournament_id = p_tournament_id and tr.user_id = auth.uid() and tr.status <> 'cancelled')
      or exists (select 1 from tournaments t where t.id = p_tournament_id and t.organizer_id = auth.uid())
      or exists (select 1 from tournament_staff ts where ts.tournament_id = p_tournament_id and ts.user_id = auth.uid());
$$;

create or replace function public.is_event_chat_member(p_event_id uuid)
returns boolean language sql security definer set search_path = public, pg_temp stable as $$
  select exists (select 1 from event_participants ep where ep.event_id = p_event_id and ep.user_id = auth.uid())
      or exists (select 1 from events e where e.id = p_event_id and (e.creator_user_id = auth.uid() or e.captain_user_id = auth.uid()));
$$;

revoke all on function public.is_league_chat_member(uuid) from public;
revoke all on function public.is_tournament_chat_member(uuid) from public;
revoke all on function public.is_event_chat_member(uuid) from public;
grant execute on function public.is_league_chat_member(uuid) to authenticated;
grant execute on function public.is_tournament_chat_member(uuid) to authenticated;
grant execute on function public.is_event_chat_member(uuid) to authenticated;

-- SELECT: members only (was USING(true)).
drop policy if exists "league_messages_select" on public.league_messages;
create policy "league_messages_select" on public.league_messages
  for select to authenticated using (public.is_league_chat_member(league_id));

drop policy if exists "tournament_messages_select" on public.tournament_messages;
create policy "tournament_messages_select" on public.tournament_messages
  for select to authenticated using (public.is_tournament_chat_member(tournament_id));

drop policy if exists "event_messages: authenticated users can read" on public.event_messages;
create policy "event_messages_select" on public.event_messages
  for select to authenticated using (public.is_event_chat_member(event_id));

-- INSERT: require membership too (league/tournament were user_id=auth.uid() only).
drop policy if exists "league_messages_insert" on public.league_messages;
create policy "league_messages_insert" on public.league_messages
  for insert to authenticated with check (user_id = auth.uid() and public.is_league_chat_member(league_id));

drop policy if exists "tournament_messages_insert" on public.tournament_messages;
create policy "tournament_messages_insert" on public.tournament_messages
  for insert to authenticated with check (user_id = auth.uid() and public.is_tournament_chat_member(tournament_id));
