-- Payment-state column tightening: a registrant's payment/refund state has no business being
-- readable by anon or by other logged-in players/spectators. The July-10 #356 column-grant
-- hardening (which hid stripe_payment_intent_id) left payment_status + refunded_at granted to
-- anon/authenticated on both registration tables — so any client that can see a registration row
-- (now RLS-gated to visible events by migrations ...02/...03) could read whether another player
-- paid / was comped / was refunded.
--
-- Column visibility is a GRANT (per-role), not RLS (per-row), so "self + organizer only" can't be
-- expressed as a grant. It doesn't need to be: every legitimate reader is server-rendered via the
-- SERVICE ROLE (self's own history at /profile/payments; the tournament detail page → props for
-- PlayersTab/DivisionsSection/DivisionManageView; the league roster manager branch, moved to the
-- service role in the commit that ships just before this migration). So revoking the anon/
-- authenticated grant closes the client leak while self/organizer keep seeing the values.
--
-- refunded_at has zero client/user-client readers; payment_status had exactly one (the league
-- roster manager query, now service-role). Ordering note: the app change deploys BEFORE this
-- revoke (a grant revoke inverts ADR-10's additive assumption).

revoke select (payment_status, refunded_at) on public.league_registrations     from anon, authenticated;
revoke select (payment_status, refunded_at) on public.tournament_registrations from anon, authenticated;
