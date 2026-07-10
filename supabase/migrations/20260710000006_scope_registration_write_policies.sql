-- Security: the registration write policies guarded only on ownership (user_id = auth.uid())
-- with NO column restriction, so a signed-in user could self-INSERT/UPDATE their own
-- registration with arbitrary columns — e.g. is_co_admin = true (league admin escalation)
-- or payment_status = 'paid' (pay-nothing) — directly via /rest/v1/…, bypassing the app.
--
-- All registration + cancellation flows go through service-role API routes (which bypass
-- RLS), and the ONLY legitimate client-side writes are organizer actions on
-- tournament_registrations (comp payment / merge division / check-in). So: drop the unused
-- self-write policies, and scope the tournament UPDATE to organizers only. Public SELECT
-- (participation — rosters/standings/browse) is left intact.

-- league_registrations: no client writes exist; register/cancel go through service-role routes.
drop policy if exists "lreg_insert" on public.league_registrations;
drop policy if exists "lreg_update" on public.league_registrations;
drop policy if exists "lreg_delete" on public.league_registrations;

-- tournament_registrations: drop the self-insert policy (registration is a service-role route)
-- and rewrite UPDATE to organizer-only (removing the user_id = auth.uid() self-branch).
drop policy if exists "registrations_user_insert" on public.tournament_registrations;
drop policy if exists "registrations_update" on public.tournament_registrations;
create policy "registrations_update" on public.tournament_registrations
  for update to authenticated
  using (
    exists (
      select 1
      from tournaments t
      join tournament_divisions d on d.tournament_id = t.id
      where d.id = tournament_registrations.division_id
        and t.organizer_id = auth.uid()
    )
  );
