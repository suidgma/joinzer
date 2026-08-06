-- Revoke EXECUTE from anon/authenticated on the SECURITY DEFINER RPCs whose security model is
-- "the route is the boundary" (ADR-03).
--
-- THE BUG THIS CLOSES. Supabase grants EXECUTE on new functions in `public` **directly to the anon
-- and authenticated roles**, not via the PUBLIC pseudo-role. Every one of these functions shipped
-- with `revoke all on function ... from public` + `grant execute ... to service_role`, which revokes
-- a grant that was never the source of the access. The explicit role grants survived, so the
-- intended "service_role only" lockdown never took effect — for any of them, since 2026-07-16.
--
-- This repo already learned this once: `20260710000004_lock_registration_rpc_execute_roles.sql`
-- fixed the same defect for three registration RPCs and states the mechanism in its own header. The
-- substitution migrations were written six days later and used the insufficient pattern anyway.
-- That is why `self_register_doubles` reads false today and everything below read true.
--
-- WHY IT MATTERS. These functions take the acting user as a PARAMETER (`p_actor_id`, `p_user_id`,
-- `p_accepter_id`) and perform NO internal authorization, by design — the calling route
-- authenticates and passes the verified actor. That design is sound only while the function is
-- unreachable except through the route. `pgrst.db_schemas` is unset (defaults to `public`), so every
-- one of these was callable over PostgREST with the publishable anon key, actor of the caller's
-- choosing. Verified before this migration: `has_function_privilege('anon', ..., 'EXECUTE')` = true
-- for all 16.
--
-- SAFETY EVIDENCE (all checked against the live catalog before writing this file):
--   * ZERO of the 16 are referenced by an RLS policy (`pg_policy.polqual`/`polwithcheck`), a view or
--     matview definition, a trigger, a column default, a generated column, or a CHECK constraint.
--     The detector was validated with a negative control — the same policy query finds 3–10
--     references each for `can_read_league`, `can_read_league_session`, `can_read_tournament`,
--     `can_operate_league_session`, `is_league_chat_member`, `is_event_chat_member` and
--     `is_tournament_chat_member` — so the zero is a fact, not a broken query.
--   * Every call site in the app uses the SERVICE-ROLE client. The seven substitution routes each
--     construct it from `SUPABASE_SERVICE_ROLE_KEY`; `accept_free_partner_invite` and all six
--     `increment_discount_uses` call sites use `service.rpc(...)`.
--   * The internal callers are other SECURITY DEFINER functions (e.g. `_reverse_sub_placement` from
--     `withdraw_sub_request`, `place_league_sub_rr` from `accept_sub_request`). Those execute as the
--     definer, so revoking the invoker roles cannot affect them.
--   * `place_league_sub_rr` / `place_league_sub_attendance` also have TypeScript wrappers
--     (`lib/leagues/assignRrSub.ts`, `assignAttendanceSub.ts`) that are exported but have **no call
--     sites** — Phase 6 consolidated everything onto the RPCs directly.
--
-- Purely subtractive: no function body, signature, owner or `service_role` grant is modified.

-- ── Substitution domain (14) ─────────────────────────────────────────────────────────────────────
-- Actor-parameter RPCs: the route authenticates, then passes the verified actor.
revoke execute on function public.accept_sub_request(uuid, uuid) from anon, authenticated;
revoke execute on function public.create_player_sub_request(uuid, uuid, text, uuid, text, uuid, text) from anon, authenticated;
revoke execute on function public.assign_organizer_sub_request(uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid, boolean, text) from anon, authenticated;
revoke execute on function public.withdraw_sub_request(uuid, uuid) from anon, authenticated;
revoke execute on function public.reclaim_sub_request(uuid, uuid) from anon, authenticated;
revoke execute on function public.organizer_correct_sub_request(uuid, uuid, text, uuid, boolean) from anon, authenticated;
revoke execute on function public.organizer_close_sub_request_record(uuid, uuid, text) from anon, authenticated;

-- Scheduler-only sweep: no actor at all, and mass-expires open requests.
revoke execute on function public.expire_sub_requests(integer) from anon, authenticated;

-- Internal placement/reversal primitives. Called only from the SECURITY DEFINER functions above
-- (definer context), never from the app directly.
revoke execute on function public.place_league_sub_rr(uuid, uuid, uuid, boolean) from anon, authenticated;
revoke execute on function public.place_league_sub_attendance(uuid, uuid, uuid, uuid, uuid, uuid) from anon, authenticated;
revoke execute on function public.reverse_league_sub_rr(uuid, uuid, uuid, text) from anon, authenticated;
revoke execute on function public.reverse_league_sub_attendance(uuid, uuid, uuid, text) from anon, authenticated;
revoke execute on function public._reverse_sub_placement(public.league_sub_requests, text) from anon, authenticated;
revoke execute on function public._sub_occasion_open(public.league_sub_requests) from anon, authenticated;

-- ── Outside the substitution domain (2) ──────────────────────────────────────────────────────────
-- These two ALSO need the PUBLIC grant revoked, and the substitution functions above do not. That
-- asymmetry is not cosmetic, so it is spelled out:
--
--   The subs migrations all ran `revoke all on function ... from public`, which was insufficient on
--   its own (the direct anon/authenticated grants survived) but DID remove the PUBLIC grant. These
--   two never had such a line, so their ACL still carries `=X/postgres` — an explicit grant to
--   PUBLIC — and anon/authenticated inherit EXECUTE through it. Revoking only the roles leaves them
--   fully callable.
--
--   So the two bugs are mirror images: revoking from PUBLIC alone is insufficient because of the
--   direct role grants, and revoking from the roles alone is insufficient because of the PUBLIC
--   grant. BOTH are required. Revoking from the roles as well as PUBLIC is not redundant — a future
--   `grant ... to anon` would otherwise silently re-open it.
--
-- Caught by the post-apply verification: after the role-only revoke, these two still read
-- `has_function_privilege('anon', ...) = true` while the other 14 read false.

-- Takes p_user_id and does NOT consult auth.uid(); called only from the invite route via
-- `service.rpc(...)`. This is the exact hardening gap recorded in docs/decisions.md, 2026-05-26.
revoke execute on function public.accept_free_partner_invite(text, uuid) from public;
revoke execute on function public.accept_free_partner_invite(text, uuid) from anon, authenticated;

-- No authorization of any kind — a bare UPDATE incrementing a usage counter. All six call sites are
-- server-side `service.rpc(...)` (Stripe webhook, checkout, register, orders). Left executable, any
-- anonymous caller could burn a tournament's discount-code allowance.
revoke execute on function public.increment_discount_uses(uuid) from public;
revoke execute on function public.increment_discount_uses(uuid) from anon, authenticated;

-- ── DELIBERATELY LEFT EXECUTABLE — do not "finish the job" by adding these ───────────────────────
-- Recorded here so a future reader cannot mistake the omission for an oversight.
--
-- 1. RLS PREDICATE HELPERS (owner decision, 2026-08-06). RLS policies invoke these as the CALLING
--    role, so revoking them disables row-level security across the app — reads would return nothing:
--      can_read_league (4 policies) · can_read_league_session (6) · can_read_tournament (5) ·
--      can_operate_league_session (3) · is_league_chat_member (4) · is_tournament_chat_member (4) ·
--      is_event_chat_member (3) — 29 policies in total.
--    Counted against pg_policy on 2026-08-06 with WORD-BOUNDARY matching (`~ '\mfn\M'`), not
--    substring matching. A plain LIKE '%can_read_league%' reports 10 for that helper because
--    `can_read_league_session` contains it as a prefix — the six policies calling the session
--    helper get counted twice, once on each line. The correct split is 4 + 6.
--
-- 2. is_captain_of(uuid, uuid) — left executable under the same owner decision, but note for the
--    record that it does NOT fit the rationale above: it is referenced by **zero** RLS policies and
--    its only caller is `lib/profile/captain-check.ts` via `service().rpc(...)`. On the evidence it
--    belongs in the revoke list with the others. Not included here because the carve-out naming it
--    was explicit; flagged for a follow-up decision rather than actioned unilaterally.
--
-- 3. CLIENT-CALLED RPCs THAT AUTHENTICATE THEMSELVES. Each derives the actor from `auth.uid()`
--    internally and is invoked with the USER's client, so revoking would break a live product flow:
--      join_event(uuid)            — components/features/events/JoinLeaveButton.tsx (browser client)
--      leave_event(uuid)           — app/api/events/[id]/leave/route.ts (user-scoped server client)
--      assign_captain(uuid, uuid)  — components/features/events/AssignCaptainButton.tsx (browser)
--    These are correctly designed: the function itself is the boundary, not the route. An anon call
--    already fails closed on the null `auth.uid()` check. Revoking them from `anon` ALONE would be a
--    safe extra tightening with no functional effect; deliberately not folded into a security
--    migration whose purpose is closing the actor-parameter hole.
--
-- 4. sync_last_login() — `RETURNS trigger`, bound to one trigger. PostgREST does not expose
--    trigger-returning functions as RPCs, so the grant is inert; revoking gains nothing and risks
--    the trigger.

-- ── Correct a claim that was never true ──────────────────────────────────────────────────────────
-- The original comment asserted "service_role only" while anon and authenticated both held EXECUTE.
comment on function public.organizer_close_sub_request_record(uuid, uuid, text) is
  'Post-generation RECORD-ONLY close of a filled substitute request: filled -> cancelled with '
  'record_closed_reason, preserving filled_by_user_id, WITHOUT reversing or rewriting placement. '
  'Refuses with use_standard_correction while the ordinary reopen/cancel path is still available. '
  'Touches no placement, attendance, round or fixture row. EXECUTE is service_role only — enforced '
  'by 20260806000003, which revoked the anon/authenticated grants that 20260806000001 left in place '
  'despite claiming otherwise (revoking from PUBLIC does not remove Supabase''s direct role grants).';
