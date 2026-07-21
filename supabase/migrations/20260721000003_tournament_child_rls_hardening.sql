-- Tournament child-table RLS hardening — the mirror of migration 20260721000002 (leagues).
-- The `tournaments` table already blocks drafts/private for anon (status='published' AND
-- visibility='public'), BUT its child tables were `USING(true)` for anon, so a hidden
-- draft/private tournament's divisions, bracket (matches), and roster (registrations, incl.
-- user_id/team_name via column grants) were readable directly via PostgREST with the browser
-- anon key. This scopes those child SELECTs to the parent's visibility.
--
-- SELECT policies only. Zero app-code changes: public /t/[id] + authed /tournaments/[id] read
-- child data via the service role (bypasses RLS); /browse reads only the tournaments table.
-- The one RLS-bound anon read is the public /t/[id] live bracket — postgres_changes on
-- tournament_matches — which keeps working for published+public tournaments because the public
-- branch of can_read_tournament is auth-independent (an anon socket passes for those rows).
--
-- Recursion-safe via a SECURITY DEFINER helper (owner bypasses RLS on internal reads), composing
-- the existing is_tournament_chat_member() membership (participant/organizer/staff) with the
-- public visibility branch + a dummy guard. All four child tables carry tournament_id directly,
-- so no session/division delegate helper is needed.

create or replace function public.can_read_tournament(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tournaments t
    where t.id = p_tournament_id and (
      (t.status = 'published' and t.visibility = 'public' and coalesce(t.dummy, false) = false)
      or t.organizer_id = (select auth.uid())
      or exists (
        select 1 from public.tournament_registrations tr
        where tr.tournament_id = t.id
          and tr.user_id = (select auth.uid())
          and tr.status <> 'cancelled'
      )
      or exists (
        select 1 from public.tournament_staff ts
        where ts.tournament_id = t.id and ts.user_id = (select auth.uid())
      )
    )
  );
$$;

grant execute on function public.can_read_tournament(uuid) to anon, authenticated;

-- Child tables: preserve each policy's existing role targeting; only swap USING(true) → the gate.
drop policy if exists divisions_read on public.tournament_divisions;
create policy divisions_read on public.tournament_divisions
  for select to anon, authenticated
  using (public.can_read_tournament(tournament_id));

drop policy if exists matches_read on public.tournament_matches;
create policy matches_read on public.tournament_matches
  for select to anon, authenticated
  using (public.can_read_tournament(tournament_id));

drop policy if exists registrations_read on public.tournament_registrations;
create policy registrations_read on public.tournament_registrations
  for select to anon, authenticated
  using (public.can_read_tournament(tournament_id));

drop policy if exists tevt_select on public.tournament_events;
create policy tevt_select on public.tournament_events
  for select to public
  using (public.can_read_tournament(tournament_id));

-- Active discount codes shouldn't leak for hidden tournaments either (every real read path is
-- service-role; the only client reader is the organizer's own management UI via the organizer
-- ALL policy, so this is pure hardening).
drop policy if exists public_read_active_codes on public.tournament_discount_codes;
create policy public_read_active_codes on public.tournament_discount_codes
  for select to public
  using (is_active = true and public.can_read_tournament(tournament_id));
