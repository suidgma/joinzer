-- Revoke EXECUTE from anon/authenticated/PUBLIC on public.is_captain_of(uuid, uuid).
--
-- Follows 20260806000003, which locked 16 SECURITY DEFINER RPCs and deliberately LEFT this one
-- executable under an owner carve-out that listed it among the RLS predicate helpers. It is not one.
-- Owner ruling 2026-08-06: lock it.
--
-- WHY IT IS DIFFERENT FROM THE ELEVEN STILL LEFT EXECUTABLE. `is_captain_of` is `LANGUAGE sql
-- STABLE`, so it **cannot** reference `auth.uid()` and **cannot** raise. Both identities arrive as
-- parameters (`viewer_id`, `target_id`), so it cannot self-guard by construction — unlike
-- `join_event` / `leave_event` / `assign_captain`, which each open with `auth.uid()` and a null
-- check and are therefore merely over-granted rather than exploitable. An unauthenticated caller
-- passing two user UUIDs learns whether one organizes a tournament or event the other is registered
-- in: participation data about real people, limited only by UUIDs not being guessable. That is
-- obscurity, not a control. Confirmed by probe: called as `anon` it EXECUTED and returned `false`
-- rather than erroring — a working oracle, not a latent one.
--
-- WHY REVOKING IS SAFE.
--   * ZERO RLS policies reference it. Measured against pg_policy with WORD-BOUNDARY matching
--     (`~ '\mis_captain_of\M'`), the method 20260806000003 documents; substring matching agrees at 0
--     here. It is named in that migration's carve-out as an RLS helper, but it is not one.
--   * Its only caller is `lib/profile/captain-check.ts:12` via the SERVICE-ROLE client, which
--     bypasses grants entirely. `service_role`'s grant is untouched below.
--
-- WHY NOT REWRITE IT TO DERIVE `viewer_id` FROM `auth.uid()`. Considered and rejected by the owner:
-- the sole caller is server-side with the service role and legitimately supplies both identities, so
-- a signature change is more blast radius for no additional protection. The revoke is the minimal
-- correct fix.
--
-- BOTH REVOKE PATHS ARE REQUIRED — this function's pre-migration ACL was
--   `=X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres`
-- and that leading `=X/` is an explicit grant to PUBLIC. Revoking from the two roles alone would
-- leave it callable through PUBLIC, which is exactly the mirror-image defect 20260806000003 hit on
-- `accept_free_partner_invite` and `increment_discount_uses`. Per docs/security.md: revoke from the
-- roles BY NAME *and* from PUBLIC, because either path alone leaves the function open.
--
-- Rollback: supabase/rollback/20260806000004_lock_is_captain_of_ROLLBACK.sql (grants captured live
-- from production before this was applied).
--
-- Purely subtractive: no body, signature, owner or service_role grant is modified.

revoke execute on function public.is_captain_of(uuid, uuid) from public;
revoke execute on function public.is_captain_of(uuid, uuid) from anon, authenticated;

comment on function public.is_captain_of(uuid, uuid) is
  'Is viewer_id a captain/organizer/staff over target_id? SECURITY DEFINER, LANGUAGE sql STABLE — '
  'it takes BOTH identities as parameters and therefore cannot self-guard (no auth.uid(), cannot '
  'raise). EXECUTE is service_role only, enforced by 20260806000004; left executable by anon until '
  'then, where it was a working oracle for organizer/participant relationships. Referenced by zero '
  'RLS policies despite once being grouped with the RLS helpers. Sole caller: '
  'lib/profile/captain-check.ts via the service-role client.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- CORRECTION (2026-08-06, pre-merge review). The header above is right about WHAT to do and wrong
-- about WHY. Appended rather than edited: this migration is already applied to production (ledger
-- 20260806210719) and applied migrations are immutable here — the precedent is the CORRECTION block
-- in 20260806000001. The revoke below the header stands unchanged and is still correct.
--
-- 1. FALSE — "`LANGUAGE sql STABLE`, so it **cannot** reference `auth.uid()`".
--    A SQL-language function CAN call `auth.uid()`. Six `SECURITY DEFINER`, `LANGUAGE sql STABLE`
--    functions in this same `public` schema do exactly that:
--      can_read_league · can_operate_league_session · can_read_tournament ·
--      is_event_chat_member · is_league_chat_member · is_tournament_chat_member
--    What a SQL-language function cannot do is `RAISE`, so it cannot deliberately FAIL CLOSED. That
--    half of the original sentence is true; the `auth.uid()` half is not.
--
-- 2. THE ACTUAL REASON `is_captain_of` could not self-guard is its own signature, not its language:
--    the body takes BOTH identities as parameters (`viewer_id`, `target_id`) and never consults
--    `auth.uid()` at all. The caller supplies both sides of the question, so there is nothing for
--    the function to check itself against. A rewrite deriving `viewer_id` from `auth.uid()` was
--    therefore possible — it was considered and rejected on blast radius, as the header records.
--
-- 3. THE SEVEN RETAINED RLS HELPERS ARE NOT IN THIS CATEGORY AND MUST REMAIN EXECUTABLE.
--    The original wording ("sql STABLE ⇒ cannot self-guard") would lead a future reader to condemn
--    them by the same test. It does not apply: six of the seven read `auth.uid()` directly and the
--    seventh (`can_read_league_session`) reaches it through `can_read_league`. Revoking them from
--    `anon`/`authenticated` disables row-level security app-wide — RLS invokes them as the CALLING
--    role, so reads would silently return nothing. See 20260806000003's carve-out, item 1.
--
-- 4. THE CORRECT TEST — check `prosrc`, never `lanname`:
--      select proname, lanname, prosrc ~* 'auth\.uid\(\)' from pg_proc where prosecdef;
--
-- 5. ALSO FALSE, in the header only — "learns whether one organizes a tournament or **event**".
--    The body has no `events` branch. It is four UNION arms: tournament ORGANIZER, tournament
--    STAFF, league CREATOR, league CO-ADMIN. The oracle disclosed a **tournament or league**
--    relationship. `events` is a distinct table with its own `join_event`/`leave_event` RPCs, so
--    "event" reads as a specific claim that is not true. The disclosure was real either way; only
--    its scope was misstated. The live `comment on function` above is NOT affected — it says
--    "organizer/participant relationships" and attributes the no-self-guard to the parameters, so
--    no DDL is needed to correct the database.
--
-- FOLLOW-UP FLAGGED, NOT ACTIONED: `lib/profile/captain-check.ts` (`isCaptainOf`) has ZERO call
-- sites repo-wide. Not accidental dead code: docs/joinzer-build-sequence.md:214 records it as
-- deliberately staged for Players-directory enforcement, "not yet wired to any viewer route (none
-- exist yet)". Either delete it or wire it — but that needs its own grep-before-delete sweep and its
-- own review, and it is no longer urgent now that the RPC is service_role only. Not folded in here.
--
-- Nothing in this block changes the database. No grant, revoke or comment is modified by it.
