-- ROLLBACK for migration 20260806000004_lock_is_captain_of.sql
--
-- Restores public.is_captain_of(uuid, uuid) to the grants it held in production immediately BEFORE
-- that migration was applied. Captured from a live catalog query against project
-- gkbibpneusfnwkjedwbi on 2026-08-06, not transcribed from a migration file or from memory.
--
-- Verbatim `pg_proc.proacl` at capture time:
--
--     =X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres
--
-- Reading that: `=X/postgres` is an entry with an EMPTY grantee, which is PUBLIC. So the function
-- was executable four ways — via PUBLIC, and via direct grants to anon, authenticated and
-- service_role. `has_function_privilege` at capture time: anon = true, authenticated = true,
-- service_role = true.
--
-- Applying this file returns the function to being callable by any unauthenticated PostgREST
-- client. That is the point of a rollback, and it is also why it should not be run casually:
-- `is_captain_of` is `LANGUAGE sql STABLE`, so it cannot read `auth.uid()` and cannot raise. Both
-- identities arrive as parameters, so it cannot self-guard by construction. Restoring these grants
-- restores an anonymous oracle: given two user UUIDs, an unauthenticated caller learns whether one
-- organizes a tournament or event the other is registered in.
--
-- Only run this if the revoke demonstrably broke something. It should not, because the sole caller
-- (lib/profile/captain-check.ts:12) uses the SERVICE-ROLE client, and service_role's grant is not
-- touched by the migration.

grant execute on function public.is_captain_of(uuid, uuid) to public;
grant execute on function public.is_captain_of(uuid, uuid) to anon, authenticated;

-- Verify the restore:
--   select has_function_privilege('anon','public.is_captain_of(uuid,uuid)','EXECUTE');          -- expect true
--   select has_function_privilege('authenticated','public.is_captain_of(uuid,uuid)','EXECUTE'); -- expect true
--   select proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='is_captain_of';                                    -- expect the ACL above
