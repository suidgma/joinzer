-- Security: league_registrations / tournament_registrations have a public SELECT RLS
-- policy (USING(true)), so anon/authenticated could read every column — including
-- stripe_payment_intent_id (the Stripe PaymentIntent id). That column is only ever read
-- server-side (via the service role) — no user-client query selects it, and none use
-- select('*'). Keep the rows readable (participation is semi-public — rosters/standings/
-- browse) but hide just that column, via column-level SELECT grants.
--
-- NOTE (maintenance): because this replaces table-level SELECT with an explicit column
-- list, any NEW column added to these tables is NOT anon/authenticated-readable until it
-- is added to a GRANT here. Secure-by-default, but remember it when adding columns the
-- client needs to read.

revoke select on public.league_registrations from anon, authenticated;
grant select (
  id, league_id, user_id, status, registered_at, is_co_admin, payment_status,
  registration_type, partner_user_id, partner_registration_id, refunded_at, sort_order
) on public.league_registrations to anon, authenticated;

revoke select on public.tournament_registrations from anon, authenticated;
grant select (
  id, tournament_id, division_id, user_id, partner_user_id, team_name, status,
  created_at, updated_at, payment_status, refunded_at, registration_type,
  partner_registration_id, checked_in, seed, pool_number
) on public.tournament_registrations to anon, authenticated;
