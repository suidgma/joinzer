-- Follow-up to 20260710000003: Supabase grants EXECUTE explicitly to the anon/authenticated
-- roles on public functions (not only via PUBLIC), so revoking from PUBLIC was insufficient
-- and they retained execute. Revoke from the roles directly. service_role keeps EXECUTE
-- (granted in 000003), so the server routes that call these via the service role are unaffected.
revoke execute on function public.register_doubles_pair(uuid, uuid, uuid, uuid, text) from anon, authenticated;
revoke execute on function public.pair_solo_registrations(uuid, uuid) from anon, authenticated;
revoke execute on function public.self_register_doubles(uuid, uuid, uuid, text, text) from anon, authenticated;
