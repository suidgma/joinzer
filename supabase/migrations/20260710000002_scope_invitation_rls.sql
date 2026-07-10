-- Security fix: both invitation tables carried a wide-open policy (roles {public}, cmd ALL,
-- USING(true) WITH CHECK(true)) — despite the misleading name "service role manages …" —
-- which let any anon/authenticated user read/insert/update/delete every row, exposing
-- invite tokens + invitee emails. Replace with least-privilege SELECT for the two people
-- an invitation concerns; all writes go through the service role in server routes (which
-- bypasses RLS, so no write policy is needed).

drop policy if exists "service role manages league partner invitations" on public.league_partner_invitations;
create policy "invitee or captain reads their partner invitation"
  on public.league_partner_invitations
  for select to authenticated
  using (
    invitee_user_id = auth.uid()
    or exists (
      select 1 from public.league_registrations r
      where r.id = league_partner_invitations.captain_registration_id
        and r.user_id = auth.uid()
    )
  );

drop policy if exists "service role manages invitations" on public.tournament_team_invitations;
create policy "invitee or inviter reads their team invitation"
  on public.tournament_team_invitations
  for select to authenticated
  using (
    invitee_user_id = auth.uid()
    or exists (
      select 1 from public.tournament_registrations r
      where r.id = tournament_team_invitations.inviter_registration_id
        and r.user_id = auth.uid()
    )
  );
