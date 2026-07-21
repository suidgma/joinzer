-- Leagues RLS hardening: make the DATABASE the backstop for league visibility, not just the
-- app-level .eq('visibility','public') filter. Before this, leagues.league_select was
-- `USING (true)` for role public, so anyone with the browser-shipped anon key could read every
-- league row (incl. private) and their rosters/sessions directly via PostgREST. Same leak on the
-- anon-readable child tables; and any logged-in user could read every league's session
-- scores/rosters/attendance.
--
-- SELECT policies only. No schema/column changes. Server-rendered member/organizer views read
-- league CHILD data via the service role (bypasses RLS), and public /l/[id] + /subs read via the
-- service role too, so this is expected to be zero-app-code-change: members/organizers/public
-- spectators are unaffected; non-members lose direct client reads of PRIVATE leagues (the leak).
--
-- Recursion-safe via SECURITY DEFINER helpers (owner bypasses RLS on internal reads), mirroring
-- the existing is_league_chat_member() pattern — a bare EXISTS against league_registrations
-- (table-level SELECT is revoked) inside a policy would fail/return nothing.

-- ── Helper: can the caller read this league? ──
-- anon (auth.uid() null) → only the public branch. status values: draft/active/completed/cancelled.
-- registration statuses that retain read access: registered / waitlist / pending_partner
-- (all legitimately in the league); only 'cancelled' is excluded. dummy leagues are test data and
-- are kept off the anon/public branch (mirrors every public surface's dummy=false filter) while
-- members of a dummy league still read it via the member branches.
create or replace function public.can_read_league(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.leagues l
    where l.id = p_league_id and (
      (l.visibility = 'public' and l.status <> 'draft' and l.status <> 'cancelled'
         and coalesce(l.dummy, false) = false)
      or l.created_by = (select auth.uid())
      or (l.self_run and l.season_host_user_id = (select auth.uid()))
      or exists (
        select 1 from public.league_registrations lr
        where lr.league_id = l.id
          and lr.user_id = (select auth.uid())
          and lr.status <> 'cancelled'
      )
    )
  );
$$;

-- ── Helper: resolve a session to its league, then delegate. ──
create or replace function public.can_read_league_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.league_sessions ls
    where ls.id = p_session_id and public.can_read_league(ls.league_id)
  );
$$;

grant execute on function public.can_read_league(uuid)         to anon, authenticated;
grant execute on function public.can_read_league_session(uuid) to anon, authenticated;

-- ── leagues + currently anon-readable children: keep role `public` (anon still gets PUBLIC rows) ──
drop policy if exists league_select on public.leagues;
create policy league_select on public.leagues
  for select to public
  using (public.can_read_league(id));

drop policy if exists lreg_select on public.league_registrations;
create policy lreg_select on public.league_registrations
  for select to public
  using (public.can_read_league(league_id));

drop policy if exists lsession_select on public.league_sessions;
create policy lsession_select on public.league_sessions
  for select to public
  using (public.can_read_league(league_id));

drop policy if exists lsub_select on public.league_sub_interest;
create policy lsub_select on public.league_sub_interest
  for select to public
  using (public.can_read_league(league_id));

drop policy if exists lssub_select on public.league_session_subs;
create policy lssub_select on public.league_session_subs
  for select to public
  using (public.can_read_league_session(session_id));

-- ── currently authenticated-only session children: keep role `authenticated` (do NOT expose to anon) ──
drop policy if exists lmatch_select on public.league_matches;
create policy lmatch_select on public.league_matches
  for select to authenticated
  using (public.can_read_league_session(session_id));

drop policy if exists "auth read rounds" on public.league_rounds;
create policy "auth read rounds" on public.league_rounds
  for select to authenticated
  using (public.can_read_league_session(session_id));

drop policy if exists "auth read round matches" on public.league_round_matches;
create policy "auth read round matches" on public.league_round_matches
  for select to authenticated
  using (public.can_read_league_session(session_id));

drop policy if exists "auth read session players" on public.league_session_players;
create policy "auth read session players" on public.league_session_players
  for select to authenticated
  using (public.can_read_league_session(session_id));

drop policy if exists lsa_read on public.league_session_attendance;
create policy lsa_read on public.league_session_attendance
  for select to authenticated
  using (public.can_read_league_session(league_session_id));
